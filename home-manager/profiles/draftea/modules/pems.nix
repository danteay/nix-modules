{ pkgs, ... }:
{
  home.file = {
    ".envs/draftea-aliases.sh".text = ''
      alias prod-bastion="ssh -i ~/.draftea/pems/prod-bastion.pem ubuntu@ec2-3-140-150-23.us-east-2.compute.amazonaws.com"
      alias dev-bastion="ssh -i ~/.draftea/pems/dev-bastion.pem ubuntu@ec2-18-223-167-16.us-east-2.compute.amazonaws.com"
    '';
  };
}
