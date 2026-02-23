#!/bin/bash
# Deploy a single Lambda function using sls package + AWS CLI
# This bypasses sls deploy function and its variable resolution issues
#
# Usage: ./deploy-lambda-function.sh <lambda-name> [options]
# Example: ./deploy-lambda-function.sh cancelpromoapplication --stage dev --profile draftea-dev --region us-east-2

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to show usage
show_usage() {
    if [ -z "$DEPLOY_FUNC_WRAPPER" ]; then
      echo "Usage: $0 <lambda-name> [options]"
      echo ""
      echo "Arguments:"
      echo "  <lambda-name>           Name of the Lambda function (required)"
      echo ""
      echo "Options:"
      echo "  --stage <stage>         Deployment stage (default: dev)"
      echo "  --profile <profile>     AWS CLI profile (default: draftea-<stage>)"
      echo "  --region <region>       AWS region (default: us-east-2)"
      echo "  -h, --help             Show this help message"
      echo ""
      echo "Examples:"
      echo "  $0 <lambda-name>"
      echo "  $0 <lambda-name> --stage prod"
      echo "  $0 <lambda-name> --stage dev --region us-west-2"
      echo "  $0 <lambda-name> --profile draftea-dev --stage dev --region us-east-1"
    fi
}

# Default values
STAGE="dev"
PROFILE=""
REGION="us-east-2"
LAMBDA_NAME=""

# Parse arguments
if [ $# -eq 0 ]; then
    echo -e "${RED}Error: Lambda name is required${NC}"
    echo ""
    show_usage
    exit 1
fi

# First argument is always the lambda name (if it doesn't start with --)
if [[ "$1" != --* ]]; then
    LAMBDA_NAME="$1"
    shift
fi

# Parse flags
while [[ $# -gt 0 ]]; do
    case $1 in
        --stage)
            STAGE="$2"
            shift 2
            ;;
        --profile)
            PROFILE="$2"
            shift 2
            ;;
        --region)
            REGION="$2"
            shift 2
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            echo -e "${RED}Error: Unknown option: $1${NC}"
            echo ""
            show_usage
            exit 1
            ;;
    esac
done

# If profile not set, use default based on stage
if [ -z "$PROFILE" ]; then
    PROFILE="draftea-$STAGE"
fi

# Validate lambda name
if [ -z "$LAMBDA_NAME" ]; then
    echo -e "${RED}Error: Lambda name is required${NC}"
    echo ""
    show_usage
    exit 1
fi

# Validate serverless.yml exists
if [ ! -f "serverless.yml" ]; then
    echo -e "${RED}Error: serverless.yml not found in current directory${NC}"
    echo "Please run this script from the service directory"
    exit 1
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Lambda Function Deployment${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Get AWS Account ID and export environment variables
echo -e "${YELLOW}Fetching AWS Account ID...${NC}"
AWS_ACCOUNT=$(aws sts get-caller-identity --profile "$PROFILE" --query 'Account' --output text 2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Failed to get AWS Account ID${NC}"
    echo "$AWS_ACCOUNT"
    echo ""
    echo "Please verify:"
    echo "  1. AWS CLI is installed"
    echo "  2. Profile '$PROFILE' is configured"
    echo "  3. AWS credentials are valid"
    exit 1
fi

echo -e "Lambda Name: ${GREEN}$LAMBDA_NAME${NC}"
echo -e "AWS Account: ${GREEN}$AWS_ACCOUNT${NC}"
echo -e "Stage: ${GREEN}$STAGE${NC}"
echo -e "Profile: ${GREEN}$PROFILE${NC}"
echo -e "Region: ${GREEN}$REGION${NC}"
echo ""

# Step 1: Install dependencies
echo -e "${YELLOW}Step 1/5: Installing dependencies...${NC}"
if [ -f "package.json" ]; then
    echo "Running npm install..."
    npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}✗ npm install failed${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Dependencies installed${NC}"
else
    echo -e "${YELLOW}⚠ No package.json found, skipping npm install${NC}"
fi
echo ""

# Step 2: Run sls package
echo -e "${YELLOW}Step 2/5: Packaging service...${NC}"
echo "Command: env STAGE=$STAGE AWS_ACCOUNT=$AWS_ACCOUNT sls package --stage $STAGE --verbose --aws-profile $PROFILE"

env STAGE="$STAGE" AWS_ACCOUNT="$AWS_ACCOUNT" sls package --stage "$STAGE" --verbose --aws-profile "$PROFILE"

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Packaging failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Packaging complete${NC}"
echo ""

# Step 3: Infer service name from serverless.yml
echo -e "${YELLOW}Step 3/5: Inferring service name...${NC}"
SERVICE_NAME=$(grep "^service:" serverless.yml | head -1 | awk '{print $2}' | tr -d '\r')

if [ -z "$SERVICE_NAME" ]; then
    echo -e "${RED}✗ Could not find service name in serverless.yml${NC}"
    exit 1
fi

echo -e "Service name: ${GREEN}$SERVICE_NAME${NC}"
echo ""

# Step 4: Create full Lambda name
echo -e "${YELLOW}Step 4/5: Constructing full Lambda name...${NC}"
FULL_LAMBDA_NAME="${SERVICE_NAME}-${STAGE}-${LAMBDA_NAME}"
echo -e "Lambda function: ${GREEN}$FULL_LAMBDA_NAME${NC}"
echo ""

# Step 5: Verify ZIP file exists
ZIP_FILE=".bin/${LAMBDA_NAME}.zip"
if [ ! -f "$ZIP_FILE" ]; then
    echo -e "${RED}✗ ZIP file not found: $ZIP_FILE${NC}"
    echo ""
    echo "Available ZIP files in .bin/:"
    ls -lh .bin/*.zip 2>/dev/null || echo "  (none)"
    echo ""
    echo -e "${YELLOW}Tip: Make sure the lambda name matches the function name in serverless.yml${NC}"
    exit 1
fi

ZIP_SIZE=$(du -h "$ZIP_FILE" | cut -f1)
echo -e "ZIP file: ${GREEN}$ZIP_FILE${NC} (${ZIP_SIZE})"
echo ""

# Step 5: Update Lambda code
echo -e "${YELLOW}Step 5/5: Updating Lambda code...${NC}"
echo "AWS Profile: $PROFILE"
echo "AWS Region: $REGION"
echo ""

UPDATE_OUTPUT=$(aws lambda update-function-code \
    --function-name "$FULL_LAMBDA_NAME" \
    --zip-file "fileb://$ZIP_FILE" \
    --profile "$PROFILE" \
    --region "$REGION" \
    --output json 2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Lambda update failed${NC}"
    echo "$UPDATE_OUTPUT"
    exit 1
fi

# Parse and display results
FUNCTION_ARN=$(echo "$UPDATE_OUTPUT" | jq -r '.FunctionArn')
CODE_SIZE=$(echo "$UPDATE_OUTPUT" | jq -r '.CodeSize')
LAST_MODIFIED=$(echo "$UPDATE_OUTPUT" | jq -r '.LastModified')
RUNTIME=$(echo "$UPDATE_OUTPUT" | jq -r '.Runtime')
REVISION_ID=$(echo "$UPDATE_OUTPUT" | jq -r '.RevisionId')

echo -e "${GREEN}✓ Lambda code updated successfully!${NC}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Deployment Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "Function: $FULL_LAMBDA_NAME"
echo "ARN: $FUNCTION_ARN"
echo "Runtime: $RUNTIME"
echo "Code Size: $(numfmt --to=iec-i --suffix=B $CODE_SIZE 2>/dev/null || echo $CODE_SIZE)"
echo "Last Modified: $LAST_MODIFIED"
echo "Revision ID: $REVISION_ID"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}Deployment complete!${NC}"