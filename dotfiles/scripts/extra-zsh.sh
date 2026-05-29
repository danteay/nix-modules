## Add LocalStack
export LOCALSTACK_AUTH_TOKEN=""

## Add Serverless 4
export ACTIVATE_PRO=0

## Add Formae
export PATH="/opt/pel/bin:$PATH"
fpath=(~/.zsh/completions $fpath) && autoload -U compinit && compinit