#! /usr/bin/env bash

export DRAFT_SENTRY_TOKEN="$(jq -r '.token' $HOME/.config/draft/config.json)"