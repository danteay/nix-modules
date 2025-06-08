{
  gitConfig = {
    userName = "Eduardo Aguilar";
    userEmail = "dante.aguilar41@gmail.com";

    extraConfig = {
      github.user = "danteay";
      core.editor = "hx";

      pull.rebase = "true";

      url."git@github.com:Drafteame".insteadOf = [ "https://github.com/Drafteame" ];
    };
  };
}