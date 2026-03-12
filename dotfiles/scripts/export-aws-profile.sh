#!/usr/bin/env bash

usage() {
  echo "Usage: use-aws-profile <profile-name>"
  echo ""
  echo "Exports AWS credentials from a named profile as environment variables:"
  echo "  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION, AWS_ACCOUNT"
  echo ""
  echo "To clear exported variables:"
  echo "  use-aws-profile --clear"
  return 1
}

if [ $# -lt 1 ]; then
  usage
  return 2>/dev/null || exit
fi

if [ "$1" = "--clear" ] || [ "$1" = "-c" ]; then
  unset AWS_ACCESS_KEY_ID
  unset AWS_SECRET_ACCESS_KEY
  unset AWS_DEFAULT_REGION
  unset AWS_ACCOUNT
  unset AWS_PROFILE
  echo "AWS environment variables cleared"
  return 0 2>/dev/null || exit 0
fi

PROFILE="$1"

# Validate that the profile exists
if ! aws configure list --profile "$PROFILE" &>/dev/null; then
  echo "Error: AWS profile \"$PROFILE\" not found"
  return 1 2>/dev/null || exit 1
fi

ACCESS_KEY=$(aws configure get aws_access_key_id --profile "$PROFILE" 2>/dev/null || true)
SECRET_KEY=$(aws configure get aws_secret_access_key --profile "$PROFILE" 2>/dev/null || true)
REGION=$(aws configure get region --profile "$PROFILE" 2>/dev/null || true)

if [ -z "$ACCESS_KEY" ] || [ -z "$SECRET_KEY" ]; then
  echo "Error: Could not retrieve credentials for profile \"$PROFILE\""
  return 1 2>/dev/null || exit 1
fi

# Get account ID using the profile credentials
ACCOUNT_ID=$(AWS_ACCESS_KEY_ID="$ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
  aws sts get-caller-identity --query "Account" --output text 2>/dev/null || true)

export AWS_ACCESS_KEY_ID="$ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$SECRET_KEY"

if [ -n "$REGION" ]; then
  export AWS_DEFAULT_REGION="$REGION"
fi

if [ -n "$ACCOUNT_ID" ]; then
  export AWS_ACCOUNT="$ACCOUNT_ID"
fi

export AWS_PROFILE="$PROFILE"
echo "AWS environment configured for profile: $PROFILE"
