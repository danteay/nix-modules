{
  gitConfig = {
    userName = "Eduardo Aguilar";
    userEmail = "dante.aguilar41@gmail.com";

    extraConfig = {
      github.user = "danteay";
      core.editor = "hx";

      pull.rebase = false;

      branch."feat/*".rebase = true;
      branch."epic/*".rebase = false;

      branch.main.rebase = false;
      branch.main.ff = "only";

      url."git@github.com:Drafteame".insteadOf = [ "https://github.com/Drafteame" ];
    };
  };
}