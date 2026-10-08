# nix-modules

My personal configuration for nix, home manager and nix-darwin.

## Installation

1. Clone the repository:

   ```bash
   cd ~/.config
   git clone https://github.com/danteay/nix-modules.git
   ```

2. Enter to the nix-modules folder and execute main installation file

   ```bash
   cd nix-modules
   sh install.sh
   ```

3. After main instalation configure 1password with needed accounts
4. Execute install credentials scripts to setup certificates and saved access from 1Password

   ```bash
   sh install_credentials.sh
   ```

## Disk cleanup

Apply Home Manager with `hms draftea` (or your selected profile) to install the
global `disk-clean` command:

```sh
disk-clean --dry-run
disk-clean
disk-clean --only gradle --only npm
disk-clean --only nix --keep 2
disk-clean --only go --tmp-min-age-hours 0
```

Run as your normal user after stopping builds and Gradle daemons (`gradle --stop`).
The command clears Go build cache, old Go temporary build directories, Gradle
caches, npm/npx caches, unused Nix generations/store paths and Nix evaluation/fetch
caches. It requests sudo only for system profile pruning. Two Nix generations
are retained by default, plus one extra package-profile generation to account
for Home Manager's intermediate updates. It does not upgrade or switch profiles.

Go temporary folders must be at least 24 hours old by default. Use an age of zero
only after finishing all builds. Categories with detected running tools or an
unavailable process list are skipped; a partial cleanup exits with status 1.
Symlinked cache directories are skipped. The preview does not delete files,
prune generations or invoke sudo.

Projects, Go module downloads, Gradle distributions/configuration, Nix
configuration, apps and databases are preserved. Caches rebuild on demand.
