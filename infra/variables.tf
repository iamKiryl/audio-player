variable "frontend_origins" {
  description = "Explicit frontend origins, including the actual laptop LAN origin (scheme, host and port; no trailing slash)."
  type        = list(string)
  default     = ["http://localhost:3000"]

  validation {
    condition = length(var.frontend_origins) > 0 && alltrue([
      for origin in var.frontend_origins : can(regex("^https?://[^/?#*[:space:]]+$", origin))
    ])
    error_message = "Provide explicit HTTP(S) origins without paths, trailing slashes or wildcards."
  }
}
