resource "aws_apigatewayv2_api" "player" {
  name          = "audio-player-dev"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = var.frontend_origins
    allow_headers = ["Authorization", "Content-Type"]
    allow_methods = ["GET", "POST"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_integration" "create_session" {
  api_id                 = aws_apigatewayv2_api.player.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.create_session.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "create_session" {
  api_id    = aws_apigatewayv2_api.player.id
  route_key = "POST /sessions"
  target    = "integrations/${aws_apigatewayv2_integration.create_session.id}"
}

resource "aws_apigatewayv2_route" "session" {
  for_each = toset([
    "GET /sessions/{id}",
    "POST /sessions/{id}/commands",
    "POST /sessions/{id}/sync",
  ])

  api_id    = aws_apigatewayv2_api.player.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.create_session.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.player.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 4
    throttling_rate_limit  = 2
  }
}

resource "aws_lambda_permission" "api_create_session" {
  statement_id  = "AllowApiGatewayCreateSession"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_session.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.player.execution_arn}/*/POST/sessions"
}

resource "aws_lambda_permission" "api_session" {
  for_each = {
    get_session = { method = "GET", path = "sessions/*" }
    commands    = { method = "POST", path = "sessions/*/commands" }
    sync        = { method = "POST", path = "sessions/*/sync" }
  }

  statement_id  = "AllowApiGateway-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_session.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.player.execution_arn}/*/${each.value.method}/${each.value.path}"
}

output "api_url" {
  value = aws_apigatewayv2_api.player.api_endpoint
}
