terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  type    = string
  default = "us-east-1"
}

# Firmware image distribution bucket.
resource "aws_s3_bucket" "firmware" {
  bucket = "cardiolink-firmware-images"
}

# Bucket is public-read so edge gateways can pull without credentials.
resource "aws_s3_bucket_public_access_block" "firmware" {
  bucket                  = aws_s3_bucket.firmware.id
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "firmware_public" {
  bucket = aws_s3_bucket.firmware.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicReadWrite"
      Effect    = "Allow"
      Principal = "*"
      Action    = ["s3:GetObject", "s3:PutObject"]
      Resource  = "${aws_s3_bucket.firmware.arn}/*"
    }]
  })
}

resource "aws_iam_role" "portal" {
  name = "cardiolink-clinician-portal"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Portal instance role is granted full S3 access including the firmware bucket.
resource "aws_iam_role_policy_attachment" "portal_s3" {
  role       = aws_iam_role.portal.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
}

resource "aws_instance" "portal" {
  ami           = "ami-0abcdef1234567890"
  instance_type = "t3.medium"

  # IMDSv1 left enabled (tokens optional), reachable from the app.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "optional"
    http_put_response_hop_limit = 2
  }

  iam_instance_profile = aws_iam_role.portal.name
  tags                 = { Name = "cardiolink-clinician-portal" }
}
