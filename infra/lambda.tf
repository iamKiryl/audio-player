resource "aws_cloudwatch_log_group" "create_session" {
  name              = "/aws/lambda/audio-player-create-session"
  retention_in_days = 3
}

resource "aws_iam_role_policy" "create_session_logs" {
  name = "create-session-logs"
  role = aws_iam_role.create_session.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ]
      Resource = "${aws_cloudwatch_log_group.create_session.arn}:*"
    }]
  })
}

resource "aws_lambda_function" "create_session" {
  function_name = "audio-player-create-session"
  role          = aws_iam_role.create_session.arn

  runtime       = "python3.13"
  handler       = "handler.lambda_handler"
  architectures = ["arm64"]
  memory_size   = 256
  timeout       = 10

  filename         = "${path.module}/../build/create-session.zip"
  source_code_hash = filebase64sha256("${path.module}/../build/create-session.zip")

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.player.name
    }
  }

  depends_on = [
    aws_iam_role_policy.create_session_dynamodb,
    aws_iam_role_policy.create_session_logs
  ]
}
