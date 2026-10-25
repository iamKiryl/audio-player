resource "aws_apigatewayv2_api" "player" {
  name          = "audio-player-dev"
  protocol_type = "HTTP"
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

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.player.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 2
    throttling_rate_limit  = 1
  }
}

resource "aws_lambda_permission" "api_create_session" {
  statement_id  = "AllowApiGatewayCreateSession"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_session.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.player.execution_arn}/*/POST/sessions"
}

output "api_url" {
  value = aws_apigatewayv2_api.player.api_endpoint
}
