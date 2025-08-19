{ pkgs, ... }:
{
  home.packages = with pkgs; [
    (writeShellScriptBin "rmb" ''
      git branch | grep -v -E '^\*|main|master|dev|v0\.x$' | xargs git branch -D
    '')

    (writeShellScriptBin "branch" ''
      git branch
    '')

    (writeShellScriptBin "fetch" ''
      git fetch origin $1 && git checkout $1
    '')

    (writeShellScriptBin "rebase-c" ''
      git add --all
      git rebase --continue
    '')

    (writeShellScriptBin "status" ''
      git status
    '')

    (writeShellScriptBin "newb" ''
      branch_name="$1/$2"
      git checkout -b $branch_name
    '')

    (writeShellScriptBin "useb" ''
      git checkout $1
    '')

    (writeShellScriptBin "push" ''
      git push -u origin HEAD
    '')

    (writeShellScriptBin "push-f" ''
      git push -f -u origin HEAD
    '')

    (writeShellScriptBin "pull" ''
      git pull origin $1
    '')

    (writeShellScriptBin "pull-r" ''
      git pull --rebase origin $1
    '')

    (writeShellScriptBin "pull-nr" ''
      git pull --no-rebase origin $1
    '')

    (writeShellScriptBin "pull-ff" ''
      git pull --ff-only origin $1
    '')

    (writeShellScriptBin "rebase" ''
      branch="$1"

      if [ "$branch" == "" ]; then
        branch="origin/main"
      fi

      git rebase -i "$branch"
    '')

    (writeShellScriptBin "commit" ''
      git add --all && \
      git commit -m "$1: $2"
    '')

    (writeShellScriptBin "chore" ''
      commit chore "$1"
    '')

    (writeShellScriptBin "fix" ''
      commit fix "$1"
    '')

    (writeShellScriptBin "feat" ''
      commit feat "$1"
    '')

    (writeShellScriptBin "refactor" ''
      commit refactor "$1"
    '')

    (writeShellScriptBin "ci" ''
      commit ci "$1"
    '')

    (writeShellScriptBin "deps" ''
      commit deps "$1"
    '')

    (writeShellScriptBin "commit-empty" ''
      git commit --allow-empty -m "chore: empty"
    '')

    # Git town commands

    (writeShellScriptBin "mainb" ''
      git remote show origin | grep 'HEAD branch' | cut -d' ' -f5
    '')

    (writeShellScriptBin "pick" ''
      # pick passed commits
      git cherry-pick $@
    '')
  ];
}