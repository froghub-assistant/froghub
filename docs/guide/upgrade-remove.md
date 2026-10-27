# Updating and removing

## Updating

```sh
~/froghub/upgrade.sh
```

It pulls the new code, rebuilds and publishes the web app, restarts the assistant if its server changed and updates
the voice containers, keeping every setting. `--no-voice` leaves the containers alone.

It asks nothing. When setup's templates have changed (the assistant's rules, say), it tells you, so you can run
`bun run setup` again to use them.

## Removing

```sh
~/froghub/remove.sh
```

It undoes setup: the assistant's service, the voice containers, the web app and the Caddy block (a copy is kept as
`.bak-froghub-remove`). It asks before each part. Your settings, the assistant's memory and Frog Hub's own folder are
only deleted if you say so.

Then it offers to undo what `install.sh` added that wasn't there before (it keeps a list in
`~/.local/share/froghub/installed`): the packages, Bun, Claude Code, the PATH lines, the docker group and the firewall
and SELinux settings. Packages something else has come to need stay.
