variable "google_client_id" {
  type      = string
  sensitive = true
  default   = "" # empty disables Google sign-in
}

variable "google_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}
