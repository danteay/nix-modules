#!/bin/bash
# Deploy an entire Serverless service using sls deploy
#
# Usage: ./sls-deploy-service.sh [options]
# Example: ./sls-deploy-service.sh --stage dev --profile draftea-dev --region us-east-2

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to show usage
show_usage() {
    if [ -z "$DEPLOY_SVC_WRAPPER" ]; then
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --stage <stage>         Deployment stage (default: dev)"
      echo "  --profile <profile>     AWS CLI profile (default: draftea-<stage>)"
      echo "  --region <region>       AWS region (default: us-east-2)"
      echo "  -h, --help             Show this help message"
      echo ""
      echo "Examples:"
      echo "  $0"
      echo "  $0 --stage prod"
      echo "  $0 --stage dev --region us-west-2"
      echo "  $0 --profile draftea-dev --stage dev --region us-east-1"
    fi
}

# Default values
STAGE="dev"
PROFILE=""
REGION="us-east-2"

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

# Validate serverless.yml exists
if [ ! -f "serverless.yml" ]; then
    echo -e "${RED}Error: serverless.yml not found in current directory${NC}"
    echo "Please run this script from the service directory"
    exit 1
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Serverless Service Deployment${NC}"
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

# Infer service name from serverless.yml
SERVICE_NAME=$(grep "^service:" serverless.yml | head -1 | awk '{print $2}' | tr -d '\r')

if [ -z "$SERVICE_NAME" ]; then
    echo -e "${RED}✗ Could not find service name in serverless.yml${NC}"
    exit 1
fi

echo -e "Service: ${GREEN}$SERVICE_NAME${NC}"
echo -e "AWS Account: ${GREEN}$AWS_ACCOUNT${NC}"
echo -e "Stage: ${GREEN}$STAGE${NC}"
echo -e "Profile: ${GREEN}$PROFILE${NC}"
echo -e "Region: ${GREEN}$REGION${NC}"
echo ""

# Step 1: Install dependencies
echo -e "${YELLOW}Step 1/2: Installing dependencies...${NC}"
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

# Step 2: Deploy service
echo -e "${YELLOW}Step 2/2: Deploying service...${NC}"
echo "Command: env STAGE=$STAGE AWS_ACCOUNT=$AWS_ACCOUNT sls deploy --stage $STAGE --verbose --aws-profile $PROFILE --region $REGION"
echo ""

env STAGE="$STAGE" AWS_ACCOUNT="$AWS_ACCOUNT" sls deploy --stage "$STAGE" --verbose --aws-profile "$PROFILE" --region "$REGION"

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Deployment failed${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Deployment Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "Service: $SERVICE_NAME"
echo "Stage: $STAGE"
echo "Region: $REGION"
echo "Profile: $PROFILE"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}Deployment complete!${NC}"
