{
  gitConfig = {
    user = {
      name = "Eduardo Aguilar";
      email = "dante.aguilar41@gmail.com";
    };

    github.user = "danteay";
    core.editor = "hx";

    pull.rebase = false;

    branch."feat/*".rebase = true;
    branch."epic/*".rebase = false;

    branch.main.rebase = false;
    branch.main.ff = "only";

    # Private Draftea repos (and Go modules) are fetched over SSH.
    url."git@github.com:Drafteame".insteadOf = [ "https://github.com/Drafteame" ];

    # Exception: public repos consumed as Nix/devenv flake inputs must stay on
    # HTTPS. devenv's flake fetcher uses libgit2, which honours insteadOf but
    # cannot authenticate over SSH, so the rewrite above turns a working
    # anonymous HTTPS fetch into "remote rejected authentication".
    # Git/libgit2 pick the longest matching insteadOf prefix, so this identity
    # rule wins over the org-wide rule for this repo only.
    url."https://github.com/Drafteame/nixpkgs".insteadOf = [
      "https://github.com/Drafteame/nixpkgs"
    ];
  };
}