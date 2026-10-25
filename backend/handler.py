import base64
import binascii
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time
import uuid
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

SESSION_SECONDS = 7200
COMMAND_SECONDS = 30
ONLINE_SECONDS = 20
MAX_BODY_BYTES = 8192
MAX_POSITION_MS = 604_800_000  # Seven days; also bounds durationMs.
MAX_SEQ = 9_007_199_254_740_991  # Largest exactly representable JS integer.
SESSION_PATH = re.compile(r"/sessions/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(/commands|/sync)?\Z")
THROTTLE_CODES = {
    "ProvisionedThroughputExceededException", "ThrottlingException",
    "RequestLimitExceeded", "Throttling",
}


class ApiError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message


def invalid(message="Invalid request body."):
    raise ApiError(400, "invalid_input", message)


def fields(value, required, optional=()):
    if not isinstance(value, dict) or not set(required) <= value.keys():
        invalid()
    if value.keys() - set(required) - set(optional):
        invalid("Unexpected fields.")
    return value


def integer(value, minimum=0, maximum=MAX_POSITION_MS):
    if type(value) is not int or not minimum <= value <= maximum:
        invalid("An integer is outside the allowed range.")
    return value


def string(value, maximum, nullable=False, empty=True):
    if value is None and nullable:
        return value
    if not isinstance(value, str) or len(value) > maximum or (not empty and not value):
        invalid("Invalid string.")
    try:
        value.encode("utf-8")
    except UnicodeError:
        invalid("Invalid Unicode string.")
    return value


def state_input(value):
    fields(value, ("trackId", "title", "status", "positionMs", "durationMs", "error"))
    string(value["trackId"], 128, nullable=True, empty=False)
    string(value["title"], 512)
    if value["status"] not in ("idle", "paused", "playing", "error"):
        invalid("Invalid playback status.")
    integer(value["positionMs"])
    integer(value["durationMs"])
    if value["positionMs"] > value["durationMs"]:
        invalid("Position exceeds duration.")
    string(value["error"], 512, nullable=True)
    return value


def command_input(value):
    fields(value, ("seq", "type"), ("trackId", "positionMs"))
    integer(value["seq"], 1, MAX_SEQ)
    if value["type"] not in ("play", "pause", "next", "seek"):
        invalid("Invalid command type.")
    if "trackId" in value:
        string(value["trackId"], 128, empty=False)
    if "positionMs" in value:
        integer(value["positionMs"])
    if value["type"] == "seek" and not {"trackId", "positionMs"} <= value.keys():
        invalid("Seek requires trackId and positionMs.")
    return value


def ack_input(value):
    fields(value, ("seq", "status", "error"))
    integer(value["seq"], 1, MAX_SEQ)
    if value["status"] not in ("applied", "failed"):
        invalid("Invalid acknowledgement status.")
    string(value["error"], 512, nullable=True)
    if value["status"] == "applied" and value["error"] is not None:
        invalid("An applied command cannot have an error.")
    return value


def reject_constant(_):
    invalid("JSON numbers must be finite.")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            invalid("Duplicate JSON field.")
        result[key] = value
    return result


def body_input(event):
    raw = event.get("body", "")
    if not isinstance(raw, str) or len(raw) > MAX_BODY_BYTES * 2:
        invalid("Request body is too large.")
    try:
        encoded = base64.b64decode(raw, validate=True) if event.get("isBase64Encoded") else raw.encode("utf-8")
        if len(encoded) > MAX_BODY_BYTES:
            invalid("Request body is too large.")
        return json.loads(encoded, parse_constant=reject_constant, object_pairs_hook=unique_object)
    except (ValueError, UnicodeError, binascii.Error, RecursionError):
        invalid("Invalid JSON.")


def json_default(value):
    if isinstance(value, Decimal) and value == value.to_integral_value():
        return int(value)
    raise TypeError("Unexpected stored value")


def response(status, payload):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(payload, default=json_default, allow_nan=False),
    }


def key_for(session_id):
    return {"pk": f"SESSION#{session_id}", "sk": "META"}


def read_session(key):
    return table.get_item(Key=key, ConsistentRead=True).get("Item")


def authorize(item, token, role, now):
    # Legacy records have no credentials and are deliberately inaccessible.
    if not item or not item.get("hostTokenHash") or not item.get("remoteTokenHash"):
        raise ApiError(404, "not_found", "Session not found.")
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    if not hmac.compare_digest(digest, item[f"{role}TokenHash"]):
        other = "remote" if role == "host" else "host"
        if hmac.compare_digest(digest, item[f"{other}TokenHash"]):
            raise ApiError(403, "wrong_role", "This token cannot perform this operation.")
        raise ApiError(401, "unauthorized", "Invalid credentials.")
    if item["expiresAt"] <= now:
        raise ApiError(410, "session_expired", "Session expired. Create a new session on the player.")


def online(item, now):
    return item.get("lastSeenAt", 0) > now - ONLINE_SECONDS


def public_command(item, now):
    command = item.get("command")
    if command is None:
        return None
    # Expiry is evaluated in code even while DynamoDB TTL has not deleted anything.
    result = {name: command[name] for name in ("seq", "type", "status", "expiresAt", "error")}
    for name in ("trackId", "positionMs"):
        if name in command:
            result[name] = command[name]
    if result["status"] == "pending" and result["expiresAt"] <= now:
        result["status"] = "expired"
        result["error"] = "Command expired before acknowledgement."
    return result


def pending_command(item, now):
    command = public_command(item, now)
    return command if command and command["status"] == "pending" else None


def conditional_failure(error):
    return error.response["Error"]["Code"] == "ConditionalCheckFailedException"


def create_session():
    now = int(time.time())
    session_id = str(uuid.uuid4())
    host_token, remote_token = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    expires_at = now + SESSION_SECONDS
    table.put_item(
        Item={
            **key_for(session_id), "sessionId": session_id, "createdAt": now,
            "expiresAt": expires_at,
            "hostTokenHash": hashlib.sha256(host_token.encode()).hexdigest(),
            "remoteTokenHash": hashlib.sha256(remote_token.encode()).hexdigest(),
            "commandSeq": 0, "command": None,
            "state": {"trackId": None, "title": "", "status": "idle", "positionMs": 0, "durationMs": 0, "error": None},
        },
        ConditionExpression="attribute_not_exists(pk)",
    )
    return response(201, {"sessionId": session_id, "hostToken": host_token, "remoteToken": remote_token, "expiresAt": expires_at})


def post_command(key, token, payload):
    for _ in range(4):
        now = int(time.time())
        item = read_session(key)
        authorize(item, token, "remote", now)
        seq = item["commandSeq"]
        current = public_command(item, now)
        if payload["seq"] == seq and current is not None:
            original = {name: current[name] for name in ("seq", "type", "trackId", "positionMs") if name in current}
            if original == payload:
                return response(200, {"commandSeq": seq, "command": current})
            raise ApiError(409, "seq_conflict", "This sequence already identifies a different command.")
        if payload["seq"] != seq + 1:
            raise ApiError(409, "seq_conflict", "Use commandSeq + 1 from the current session.")
        if not online(item, now):
            raise ApiError(409, "offline", "The player is offline.")
        if current and current["status"] == "pending":
            raise ApiError(409, "command_pending", "Wait for the current command to finish.")
        command = {**payload, "status": "pending", "expiresAt": now + COMMAND_SECONDS, "error": None}
        try:
            table.update_item(
                Key=key,
                UpdateExpression="SET commandSeq = :seq, #cmd = :command",
                ConditionExpression=(
                    "attribute_exists(pk) AND expiresAt > :now AND commandSeq = :previous "
                    "AND lastSeenAt > :online_after AND "
                    "(attribute_not_exists(#cmd.#status) OR #cmd.#status <> :pending OR #cmd.expiresAt <= :now)"
                ),
                ExpressionAttributeNames={"#cmd": "command", "#status": "status"},
                ExpressionAttributeValues={":seq": payload["seq"], ":previous": seq, ":command": command, ":now": now, ":online_after": now - ONLINE_SECONDS, ":pending": "pending"},
            )
            return response(202, {"commandSeq": payload["seq"], "command": command})
        except ClientError as error:
            if not conditional_failure(error):
                raise
            # A simultaneous sync/command changed the condition; re-evaluate a strong read.
    raise ApiError(409, "concurrent_change", "Session changed concurrently. Read it again before retrying.")


def sync_session(key, token, payload):
    ack = payload.get("ack")
    for _ in range(4):
        now = int(time.time())
        item = read_session(key)
        authorize(item, token, "host", now)
        command = pending_command(item, now)
        apply_ack = ack is not None and command is not None and command["seq"] == ack["seq"]
        names = {"#state": "state"}
        values = {":state": payload["state"], ":now": now}
        update = "SET #state = :state, lastSeenAt = :now"
        condition = "attribute_exists(pk) AND expiresAt > :now"
        if apply_ack:
            # Update only the matching live command, never replace a newer command map.
            names.update({"#cmd": "command", "#status": "status", "#error": "error", "#seq": "seq"})
            values.update({":seq": ack["seq"], ":pending": "pending", ":status": ack["status"], ":error": ack["error"]})
            update += ", #cmd.#status = :status, #cmd.#error = :error"
            condition += " AND commandSeq = :seq AND #cmd.#seq = :seq AND #cmd.#status = :pending AND #cmd.expiresAt > :now"
        try:
            result = table.update_item(
                Key=key, UpdateExpression=update, ConditionExpression=condition,
                ExpressionAttributeNames=names, ExpressionAttributeValues=values,
                ReturnValues="ALL_NEW",
            )["Attributes"]
            # ALL_NEW includes a command accepted concurrently with our initial read.
            return response(200, {"expiresAt": result["expiresAt"], "command": pending_command(result, int(time.time()))})
        except ClientError as error:
            if not conditional_failure(error):
                raise
    raise ApiError(409, "concurrent_change", "Session changed concurrently. Retry synchronization.")


def route(event):
    http = event.get("requestContext", {}).get("http", {})
    method, path = http.get("method"), http.get("path", "")
    if event.get("version") != "2.0":
        raise ApiError(400, "invalid_event", "HTTP API payload v2 is required.")
    if method == "POST" and path == "/sessions":
        fields(body_input(event), ())
        return create_session()
    match = SESSION_PATH.fullmatch(path)
    if not match or (method, match[2]) not in (("GET", None), ("POST", "/commands"), ("POST", "/sync")):
        raise ApiError(404, "not_found", "Route not found.")
    headers = event.get("headers") or {}
    auth = next((v for k, v in headers.items() if k.lower() == "authorization"), "")
    parts = auth.split() if isinstance(auth, str) else []
    if len(parts) != 2 or parts[0].lower() != "bearer" or not re.fullmatch(r"[A-Za-z0-9_-]{43}", parts[1]):
        raise ApiError(401, "unauthorized", "A Bearer token is required.")
    token, key = parts[1], key_for(match[1])
    if method == "GET":
        now = int(time.time())
        item = read_session(key)
        authorize(item, token, "remote", now)
        return response(200, {"sessionId": item["sessionId"], "expiresAt": item["expiresAt"], "online": online(item, now), "state": item["state"], "commandSeq": item["commandSeq"], "command": public_command(item, now)})
    # Authenticate before validating the protected payload, including role checks.
    authorize(read_session(key), token, "host" if match[2] == "/sync" else "remote", int(time.time()))
    payload = body_input(event)
    if match[2] == "/commands":
        return post_command(key, token, command_input(payload))
    fields(payload, ("state",), ("ack",))
    state_input(payload["state"])
    if "ack" in payload:
        ack_input(payload["ack"])
    return sync_session(key, token, payload)


def lambda_handler(event, context):
    request_id = getattr(context, "aws_request_id", "unknown")
    try:
        return route(event)
    except ApiError as error:
        return response(error.status, {"error": {"code": error.code, "message": error.message}, "requestId": request_id})
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "Unknown")
        # Never log exception messages, request bodies, Authorization, or tokens.
        logger.error("DynamoDB failure code=%s requestId=%s", code, request_id)
        status = 429 if code in THROTTLE_CODES else 500
    except Exception as error:
        logger.error("Unhandled failure type=%s requestId=%s", type(error).__name__, request_id)
        status = 500
    return response(status, {"error": {"code": "throttled" if status == 429 else "internal_error", "message": "Please retry later."}, "requestId": request_id})
