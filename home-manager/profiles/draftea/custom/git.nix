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

    url."git@github.com:Drafteame".insteadOf = [ "https://github.com/Drafteame" ];
  };
}