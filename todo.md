For each todo item, interview the user extensively to deeply understand the scope and goal of each.

- [x] Organize the files in src in to folders so it is easier to understand the structure of the code.
- [x] Move docs/plugin-contract.md into README.md and remove the docs folder.
- [x] The plugins/scheduling is an example and shouldn't be committed to the plugins directory since that should be empty to be able to be mounted in via docker or other means for the users/develoeprs using this application/framework. Put it in the examples folder instead.
- [x] The config folder should be empty and the current settings in the menu.ts should be the fallback default. IF a menu.ts where to appear in that folder, it should override the default settings with whatever is in it. The idea is the folder should be empty by default and you mount it in your docker container with your config.
- [ ] Make the internal admin pages for users groups etc into a plugin instead in the examples folder and remove them from the internal source. Add a part in the quick start about copying this plugin into the plugins folder to enable GUI user- and group admining.
- [ ] Build and publish docker image as CI/CD.
- [ ] Add i18n support.
- [ ] Set up CI/CD. Tests on push to any branch. Require PR to main and don't allow merge if tests does not pass. Publish docker image on valid semver tag. Sync up to github when merging to main.