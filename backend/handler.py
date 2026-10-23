import json
import os
import time
import uuid

import boto3

table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])

def lambda_handler(event, context):
    session_id = str(uuid.uuid4())

    item = {
        "pk": f"SESSION#{session_id}",
        "sk": "META",
        "sessionId": session_id,
        "createdAt": int(time.time())
    }

    table.put_item(
        Item=item,
        ConditionExpression="attribute_not_exists(pk)",
        )

    return {
        "statusCode": 201,
        "headers": {
            "Content-Type": "application/json"
        },
        "body": json.dumps({
            "sessionId": session_id,
            "requestId": context.aws_request_id
        })
    }
