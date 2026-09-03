# Changelog

## [](https://github.com/wygoralves/panes/compare/v0.65.0...vnull) (2026-09-03)

### Bug Fixes

* **engines:** hand the bundled resource dir to extra Claude instances so they stay available in packaged builds ([b979624](https://github.com/wygoralves/panes/commit/b9796243e91555fc3100be3fb72a7c3bcbebd2d1))

## [](https://github.com/wygoralves/panes/compare/v0.64.0...vnull) (2026-09-02)

### Features

* **chat:** add a shared working indicator with a pixel loader and live timer ([970f15b](https://github.com/wygoralves/panes/commit/970f15bb0470260580a9753c17e30dfedbc88ad4))
* **chat:** keep the composer text per thread across switches ([fed5efd](https://github.com/wygoralves/panes/commit/fed5efd375dbed807692621754202d940a051922))
* **chat:** lift pending approvals into a deck above the composer ([9791074](https://github.com/wygoralves/panes/commit/979107436261fe766945da9d448d18dc9dcb599c))
* **chat:** move task lists onto the block grammar with a progress ring ([a5a5fb3](https://github.com/wygoralves/panes/commit/a5a5fb312a306485a39f9ca8c2cfd15883a42009))
* **chat:** open thinking blocks while they stream with a clamped tail and live timer ([5c565d2](https://github.com/wygoralves/panes/commit/5c565d203c2adf3a075bb34fbfb20c03cd9102e1))
* **chat:** render actions as a verb plus chip with diff stats ([a26e8f8](https://github.com/wygoralves/panes/commit/a26e8f851dc3d4f4c33a866f922b753c7c93d54f))
* **chat:** show a caret at the streaming write head and highlight open code fences ([475ebdd](https://github.com/wygoralves/panes/commit/475ebdda5552d2b9741ae2183e21fd9b956d1d6f))
* **sidebar:** group threads as an inbox with card rows, state glyphs, and empty states ([37bba48](https://github.com/wygoralves/panes/commit/37bba48d972c6509acdc305ec5d9c83fb09caac4))
* **sidebar:** show unsent threads as drafts instead of done ([09afd89](https://github.com/wygoralves/panes/commit/09afd897904d19818ba2ed9f167c9b1866779fc9))
* **sidebar:** surface typed drafts as rows with discard, hide empty ones ([f5268f0](https://github.com/wygoralves/panes/commit/f5268f0b87e1951df9ed5d0b4decd34645afaee7))

### Bug Fixes

* **chat:** classify diff headers by position so +++ and --- content lines count ([f8e2acd](https://github.com/wygoralves/panes/commit/f8e2acd2801f3344d53267efce176a843a06f8ee))
* **chat:** hide generic deny and cancel for custom-payload approvals ([20e205e](https://github.com/wygoralves/panes/commit/20e205ed12bb44c91bbbf3230a2e5b020b629a6a))
* **chat:** keep the model picker inside the viewport on the new thread page ([a7094ed](https://github.com/wygoralves/panes/commit/a7094edc2eaa6d2543cdcadf2188be2da71659ba))
* **chat:** open the model picker below the composer when the list fits ([fc99308](https://github.com/wygoralves/panes/commit/fc99308acf3db258d7f38dcb2c2bd2d70dcfb96a))
* **chat:** show a first-turn placeholder on an empty thread ([ce0e102](https://github.com/wygoralves/panes/commit/ce0e102b75b418cfbe4bf6753d19d6e0ef7d4cd3))
* **db:** count every stored message so interrupted first turns never read as empty threads ([c5cfea4](https://github.com/wygoralves/panes/commit/c5cfea490a0649c121d2082d89409cbc2a63244b))
* **sidebar:** let the settled shelf collapse even when it is the whole list ([79c0aec](https://github.com/wygoralves/panes/commit/79c0aec78d8b81988a95e88aeb84de23d265ff98))

## [](https://github.com/wygoralves/panes/compare/v0.9.0...vnull) (2026-09-02)

### Features

* add an autonomy preset ladder for chat execution policy ([3c6ecfa](https://github.com/wygoralves/panes/commit/3c6ecfac6b8f5f1ed8d6fb6a2217a52d20641ec5))
* add chat attachments, plan mode toggle, and context usage display ([fc8f0b9](https://github.com/wygoralves/panes/commit/fc8f0b9aee21faf697e7fee65fd16a33201e908f))
* add claude sdk integration to Panes ([d48e209](https://github.com/wygoralves/panes/commit/d48e209414b21dade2b7383c0dc5cc4747043e62))
* add Codex as native harness with featured card styling ([8e2ce12](https://github.com/wygoralves/panes/commit/8e2ce128c2125710c096b3f83e92242d6936a7f9))
* add context menu in linux for terminal copy and paste actions ([5e12ccf](https://github.com/wygoralves/panes/commit/5e12ccf57fdaeb1e53aeade8b9ac802cffbb3e0c))
* add custom linux chrome ([5ded6f9](https://github.com/wygoralves/panes/commit/5ded6f94d349af1a1e57885b39356a5e89dbb75e))
* add desktop i18n with persisted locale ([4d5c9aa](https://github.com/wygoralves/panes/commit/4d5c9aa9f9232751695c23fc849392096f50b7ac))
* add diff editing in file editor ([5f1891c](https://github.com/wygoralves/panes/commit/5f1891cfd683e1e9a3a714e01fbe0b0cf8e972bf))
* add drop to attach and allow txt and image attachments ([89e476c](https://github.com/wygoralves/panes/commit/89e476cb954bf0808a97b9955958a800766a188a))
* add en and pt-BR copy for the chat component rework ([20496ae](https://github.com/wygoralves/panes/commit/20496ae132bcc0a76e94de836a9f18c9590b9980))
* add file tree cache and progressive palette search ([b0d00b3](https://github.com/wygoralves/panes/commit/b0d00b3637a2a8a703ed0b9438e1bc234c64dd25))
* add focus mode ([acaf16c](https://github.com/wygoralves/panes/commit/acaf16c6867fbeeb2329a2c2c088e1037db7de22))
* add folder discard controls for git panel ([bcf81bf](https://github.com/wygoralves/panes/commit/bcf81bffa25b5bde4800144b42d7849a34dc2440))
* add Gemini CLI harness and landing page integrations section ([383e1d4](https://github.com/wygoralves/panes/commit/383e1d4f0cc8bbaf2bbee17fff8c058be457129d)), closes [#4285f4](https://github.com/wygoralves/panes/issues/4285f4)
* add git worktrees management in git panel ([f98ba20](https://github.com/wygoralves/panes/commit/f98ba20dd5efee407046d3cdf8f5b3a55a0a163a))
* add git worktrees to multi-agent launching ([e09d60c](https://github.com/wygoralves/panes/commit/e09d60c8adaf7960969f1bc15ec6cb0d59ce0332))
* add harness identification for terminal tabs ([53f5699](https://github.com/wygoralves/panes/commit/53f569954a29ab8581a0e5abf3b0a9e5940bdf80))
* add harness installation panel for CLI tools ([6b939d0](https://github.com/wygoralves/panes/commit/6b939d0ce8275325da82be258ca658a963838417))
* add hunk navigation to git diff editor ([45cf3da](https://github.com/wygoralves/panes/commit/45cf3da1fd86599d02a27bea3f8a6991991c3a39))
* add keep awake feature to linux and macos builds ([fdd0791](https://github.com/wygoralves/panes/commit/fdd079168d3454dfe9b494912e93559367975d32))
* add landing light theme and refresh product mockup ([017672f](https://github.com/wygoralves/panes/commit/017672f9809019e659f6cb04c430110f85b7d932))
* add linux AppImage desktop integration ([5ddbb7a](https://github.com/wygoralves/panes/commit/5ddbb7ad5f88258a037d7214be3e873aa2e598da))
* add Linux custom window chrome ([081a88b](https://github.com/wygoralves/panes/commit/081a88b99251038885d74efdd91cc56c4d8b3e1b))
* add metadata only resync path for title reconciliation ([6b654ea](https://github.com/wygoralves/panes/commit/6b654ea6fc3fe64505346f6d9ec482c58b1885d3))
* add multiagent launching and broadcast mode ([de77a03](https://github.com/wygoralves/panes/commit/de77a036a8fe66957b330d3043507e990a49a0e1))
* add new command palette feature ([f94702b](https://github.com/wygoralves/panes/commit/f94702b75c88f926867e01c3650c935dd7180d14))
* add Panes brand system and assets ([ba5c988](https://github.com/wygoralves/panes/commit/ba5c98879ce01a3cb306563b3d92a88e5b60ffc2))
* add per-harness launch flags to the agents menu ([f41b9f4](https://github.com/wygoralves/panes/commit/f41b9f45d19872c002b531a5543a14453655b130))
* add performance improvements to chat and git panels ([3211e3c](https://github.com/wygoralves/panes/commit/3211e3ca46de7b6537f119dde24aa28b85dff97e))
* add resize handle for diff component on the git panel ([5ba32a5](https://github.com/wygoralves/panes/commit/5ba32a5f86ed689f1182e288c1599cae9772823b))
* add server-side branch search and load-more pagination ([04c7104](https://github.com/wygoralves/panes/commit/04c7104a5ed0a445bb481778eb8d136eb935e681))
* add soft reset to git panel ([878b099](https://github.com/wygoralves/panes/commit/878b099571aad8fd2e83da27ed11781e536bd959))
* add tests for claude sdk ([39b200d](https://github.com/wygoralves/panes/commit/39b200da284f196195e7ce0bf8a2ed5e5916688a))
* add unified chat component styles ([9313243](https://github.com/wygoralves/panes/commit/9313243bf3ae6ca44dc9f634e743be7c07a5a0b3))
* add unified fullscreen settings ([f77548c](https://github.com/wygoralves/panes/commit/f77548cdb1056e137006866b3fdc23955d4c54b9))
* add universal macOS release support ([2917b8d](https://github.com/wygoralves/panes/commit/2917b8d26fa76bd3981b6f71cc7ead24fe71d061))
* add usage limits to chat and Manage ([b65827c](https://github.com/wygoralves/panes/commit/b65827ce04683a765aec1c4374cf43849745d91c))
* add workspace pane splitting ([b6c83ca](https://github.com/wygoralves/panes/commit/b6c83ca764ab1ad07f2760f78b5c1292f41a724b))
* add workspace settings for terminal and preferences ([2463a96](https://github.com/wygoralves/panes/commit/2463a9613039111eb8780b7ffb3800654930738f))
* adjust semantics of the usage metrics ([f9af64c](https://github.com/wygoralves/panes/commit/f9af64c628e9928c859b31bd8a4ab868a850d148))
* adjust settings dropdown styling ([c5f8952](https://github.com/wygoralves/panes/commit/c5f89526537d14365d05b4a309f5fa7eeb29b712))
* align Claude sandbox and approval contracts ([e0745c8](https://github.com/wygoralves/panes/commit/e0745c878a16e702125cf205e10c78e5f949af40))
* apply brand identity to desktop app ([f65c49d](https://github.com/wygoralves/panes/commit/f65c49d7ddbeb93e95b8241259d63567e24582c1))
* apply layout redesign ([17e977e](https://github.com/wygoralves/panes/commit/17e977e56010d830fc8b9e2571d8b969c9019f9e))
* automatically checkout when creating new branch ([9d2da63](https://github.com/wygoralves/panes/commit/9d2da631e7779d1d211806f369145fdbb393c31f))
* batch terminal input and add renderer toggles ([ef49fca](https://github.com/wygoralves/panes/commit/ef49fca35955646b2d7dde984f75491b23f38a3a))
* cap git diff previews and reuse diff viewer ([287acf8](https://github.com/wygoralves/panes/commit/287acf8d6d5f5e28b8f6e7bb9d04b920d034a8f8))
* **chat:** add cycle between last messages with option + arrow ([6fbf39e](https://github.com/wygoralves/panes/commit/6fbf39e3bec3436106993a73b632b20f5ec55745))
* **chat:** add file link opening to file editor ([f44a04e](https://github.com/wygoralves/panes/commit/f44a04e50964eef9ae9f191f0c5a8fafabe63bc9))
* **chat:** add inline file reference resolution ([3c35b5e](https://github.com/wygoralves/panes/commit/3c35b5ee6bbe2ef0d1f0f39b38de8ad541b69546))
* **chat:** add markdown rendering when streaming and fix some broken md renders ([2cff55c](https://github.com/wygoralves/panes/commit/2cff55c2d898667e41fbef0ede0c8b4444e63973))
* **chat:** add opus 4.7 to chat model picker and gate hyperlinks through shift+click ([b931e25](https://github.com/wygoralves/panes/commit/b931e25414e9e4f17203692d57f3b39341afdaff))
* **chat:** add pasted image previews ([5ea88ed](https://github.com/wygoralves/panes/commit/5ea88ed487b6eb3bbc498cca44e6eb58566c2c5e))
* **chat:** add question details for answer blocks ([e1cbb46](https://github.com/wygoralves/panes/commit/e1cbb464ec09bdc28a6e44a067e6aa560497321b))
* **chat:** add switch to toggle diff view on file editor ([857f59e](https://github.com/wygoralves/panes/commit/857f59e14f5bc208fa0a9b32fb2259d88c845ca0))
* **chat:** adjust notification dot color ([fc5d579](https://github.com/wygoralves/panes/commit/fc5d579557f6b268389d128c2661e55fb52c6728))
* **chat:** expose Codex runtime permissions ([75d7997](https://github.com/wygoralves/panes/commit/75d79975602527883a12f22d427ffadeecf53001))
* **chat:** improve answered questions UI ([7426d49](https://github.com/wygoralves/panes/commit/7426d49bdc435ecc71ab7dc2a0a0e0fe487883a7))
* **chat:** improve default model heritage between threads ([d064545](https://github.com/wygoralves/panes/commit/d0645457ed1679945834a1fea7b226960eaa849b))
* **chat:** improve fast mode and model pickers ([ead1cbb](https://github.com/wygoralves/panes/commit/ead1cbb3d2df84d8800078561c3161ff02620069))
* **chat:** improve markdown rendering ([50f7c42](https://github.com/wygoralves/panes/commit/50f7c42f5bc089afb337d141b58b8522c45e2e2b))
* **chat:** improve styling on text and icons ([a82b4dc](https://github.com/wygoralves/panes/commit/a82b4dcfd82aa3963244a50792c5e86bba184ee6))
* **chat:** improve thinking blocks handling ([2f60bc5](https://github.com/wygoralves/panes/commit/2f60bc500f86514a01e1b1cbbc3d2e798dd2706c))
* **chat:** improve UI for steering and add copy messages ([e2183a8](https://github.com/wygoralves/panes/commit/e2183a86c01e8cf04375c95c05590271cd2aed95))
* **chat:** improve UI on the chatarea ([81b93e8](https://github.com/wygoralves/panes/commit/81b93e8ae9591c64d5d0acfd723f8a37c6285fbd))
* **chat:** improve usability for claude code planning mode ([b39668a](https://github.com/wygoralves/panes/commit/b39668a7b3a874973b68b27ba783f14a7e1825e3))
* **chat:** improve visibility of commands ([357a031](https://github.com/wygoralves/panes/commit/357a031db930b44c0709f727000a23d7b7e3086b))
* **chat:** make code blocks readability better ([6912133](https://github.com/wygoralves/panes/commit/69121330d3619e073c165a8ea28cd141bc1b05be))
* **chat:** make expandable blocks appear compressed by default ([fea4658](https://github.com/wygoralves/panes/commit/fea46583e5bba5765ceab350239465305c8dd972))
* **chat:** reduce clutter on chat UI and add thinking duration ([7b89fdb](https://github.com/wygoralves/panes/commit/7b89fdb2739dfd724ff2e5dd34e25cf32926ae71))
* **chat:** remove orphaned empty messages when stopping turns and improve ui for tool call results ([ce1f96e](https://github.com/wygoralves/panes/commit/ce1f96e885c63d34f93112f2af0981a732617a5c))
* **chat:** smoothen md renderer worker visibility ([4273b04](https://github.com/wygoralves/panes/commit/4273b045ee40bfa339ee684a0a11d0c278ca3820))
* **chat:** smoothen UI components on the chat area to make it more scannable ([e71bd09](https://github.com/wygoralves/panes/commit/e71bd099625fe56524d93496b6ce05498819212a))
* **claude:** expand more feature coverage and parity on plan mode and tool use ([7dd7522](https://github.com/wygoralves/panes/commit/7dd7522de04b4aad035cbfd68fa8f1ee05ac91f4))
* **codex:** add mid-turn steering ([94f2c2b](https://github.com/wygoralves/panes/commit/94f2c2b9e33a78eca0bff2a81625b73ad1a353e0))
* **codex:** add native review turns ([c99a545](https://github.com/wygoralves/panes/commit/c99a5450439564d7f0f984786cd8d9b9f65144e2))
* **codex:** add native thread branching tools ([c686536](https://github.com/wygoralves/panes/commit/c68653697e9feebef6dccb7dfafeb6c6971a225c))
* **codex:** add turn configuration parity ([1923c92](https://github.com/wygoralves/panes/commit/1923c922ca691463c263168a3c01cd5c328c0182))
* **codex:** address more review findings across backend, stores, and components ([5a06ef1](https://github.com/wygoralves/panes/commit/5a06ef1ddb28c4cf49826fae553285d7d6ed9f84))
* **codex:** address more review findings across backend, stores, and components ([996b613](https://github.com/wygoralves/panes/commit/996b613fe7d38db0b90236dd8817f6daf80864ab))
* **codex:** address review findings across backend, stores, and components ([7cc6986](https://github.com/wygoralves/panes/commit/7cc6986cb4ecff811f4932e0c8561180bf93ff9d))
* **codex:** align app-server chat protocol ([7edf0e6](https://github.com/wygoralves/panes/commit/7edf0e650f518285a3214e50ed4188cfb4dde728))
* **codex:** align plan questionnaire to not have ui leakages ([068f8f6](https://github.com/wygoralves/panes/commit/068f8f615232944734de83f98d8667922e80807b))
* **codex:** close notification parity gaps ([03b18ad](https://github.com/wygoralves/panes/commit/03b18ad0926a9287df1b821da5d2a864a0cc2b7a))
* **codex:** close runtime notification parity gaps ([9640c49](https://github.com/wygoralves/panes/commit/9640c49c867ac01aeeb503724db6647851cd1282))
* **codex:** expand approval request parity ([45243eb](https://github.com/wygoralves/panes/commit/45243ebaac246d7232cdc800bb00fff70a52f767))
* **codex:** finishing touches on UI for tool input questionnaire ([9733ccb](https://github.com/wygoralves/panes/commit/9733ccbf46b69889179ba156cd25fe092d6bbc3d))
* **codex:** improve compatibility with plan mode ([4da018f](https://github.com/wygoralves/panes/commit/4da018fcb64f960dcc6e5178fca41b72e8bca7bc))
* **codex:** improve fast UX and fix fmt issues ([30405f3](https://github.com/wygoralves/panes/commit/30405f34b3adf712b6201ae69c12bae7b51b0760))
* **codex:** improve UI for slash commands ([438ed9f](https://github.com/wygoralves/panes/commit/438ed9f5e3990968f15d4b67dc1197bcefbc3784))
* **codex:** inline steer messages in active assistant bubble ([4f2f741](https://github.com/wygoralves/panes/commit/4f2f741bbba184d1e4de44d4d7b858cf33150697))
* **codex:** keep Codex thread state and approval controls consistent ([114ac1a](https://github.com/wygoralves/panes/commit/114ac1a0010c97c96e4e7853b866b6fee7b3ef1a))
* **codex:** make plan mode prompt-guided ([ebce872](https://github.com/wygoralves/panes/commit/ebce8728cd816e0fffb9521d7d20462c038c5d74))
* **codex:** polish components in slash commands ([59967a8](https://github.com/wygoralves/panes/commit/59967a881822eb506a3659889f138a201bd84fe1))
* **codex:** polish UI for tool input questionnaire ([0646136](https://github.com/wygoralves/panes/commit/0646136eff377fb7fca4307af98f898c619d4a8c))
* **codex:** preserve runtime model metadata ([40929d7](https://github.com/wygoralves/panes/commit/40929d775dc7afcd7f5f44fd99f4c019705db080))
* **codex:** resume remote app-server threads ([ff22589](https://github.com/wygoralves/panes/commit/ff22589502763a3a7c2ee9aab9595b3488f6aa9e))
* **codex:** reuse codex threads across model changes ([56b90d0](https://github.com/wygoralves/panes/commit/56b90d0640615c13e00958c54376f892180d7baa))
* **codex:** support skills and app mentions ([1cfdea3](https://github.com/wygoralves/panes/commit/1cfdea3d7ada27ff9c4e8e3b3ff3ea08fe6450ca))
* **codex:** surface runtime diagnostics ([b73e455](https://github.com/wygoralves/panes/commit/b73e455e49129d7c3c18c572a09a0050b1bbb6d6))
* **commandpalette:** improve multi repo handling in git operations ([d6452b3](https://github.com/wygoralves/panes/commit/d6452b3f78d5340ad43b4ea930848e73b778b640))
* consolidate the chat composer, status bar, and approvals ([0278588](https://github.com/wygoralves/panes/commit/0278588c3dcc2ee53818cf355633cf9b4ed1ee66))
* disable files and threads search by default ([6a5f3d6](https://github.com/wygoralves/panes/commit/6a5f3d658e890c221e066c2c5cf0a5339d68bcbf))
* discover runtime models and provider limits ([19c94f4](https://github.com/wygoralves/panes/commit/19c94f4b9dcfd9829ac48c21ea9fbdfc681290ec))
* **editor:** add collapsible file explorer ([ac0fe3f](https://github.com/wygoralves/panes/commit/ac0fe3ffa6d6e405a1b4cddbfa6394a5b7cf56c4))
* **editor:** add contextual menu for actions and bulk actions in file explorer ([4929521](https://github.com/wygoralves/panes/commit/4929521ec08d1af97366b4179b0284980946a3c8))
* **editor:** add syntax highlighting for Java and C# files ([332cc87](https://github.com/wygoralves/panes/commit/332cc8727f3f589bcf9a5b32cadbdbbe303da884))
* **editor:** adjust plus button positioning on the file explorer ([934edf2](https://github.com/wygoralves/panes/commit/934edf2e83270da29be459bc02c31b9b44753af0))
* **editor:** open files in the default app ([1a2ac41](https://github.com/wygoralves/panes/commit/1a2ac416a7f1b6d965c77b2363c85def4a8754f3))
* expand i18n coverage on git panel ([fec0078](https://github.com/wygoralves/panes/commit/fec007805ec937403f260c7a69e5a135b4a3d975))
* expand i18n coverage on the chat panel ([dcf7ff1](https://github.com/wygoralves/panes/commit/dcf7ff1f5691e7aa3e3b5c9b9c8a7e468a5df315))
* expand i18n coverage on the command palette ([7aff162](https://github.com/wygoralves/panes/commit/7aff162483b5dbf1b76aecb65368d71ab26aa3e3))
* expand i18n coverage on the file editor ([1e4370f](https://github.com/wygoralves/panes/commit/1e4370f3a2419d3e782f4255aef26b80adb420c8))
* expand i18n coverage on the harnesses page ([816c443](https://github.com/wygoralves/panes/commit/816c443e02ad4e51c585dad6cb5ba0c8693ae553))
* expand i18n coverage on the startup settings ([57f750f](https://github.com/wygoralves/panes/commit/57f750fac9c7e4fd81a43550ce487a69ceb01e8e))
* expand i18n coverage on the terminal panel ([5401798](https://github.com/wygoralves/panes/commit/5401798fa1a6d9fe174fc60bab3f61889b1221c8))
* expand i18n coverage on the workspace settings ([8ea86ae](https://github.com/wygoralves/panes/commit/8ea86ae84c8c27761af153408bb71f25ee440a39))
* expand i18n coverage to the lp and docs ([bf4298e](https://github.com/wygoralves/panes/commit/bf4298e1cb4d457bf25ff2ca758a9693b3351511))
* **fileeditor:** add markdown preview to file editor ([dbc339a](https://github.com/wygoralves/panes/commit/dbc339a92883997de627562bbe53b26b78e9cc89))
* filter out hidden repos according to workspace settings ([27dc8a2](https://github.com/wygoralves/panes/commit/27dc8a29d9267db68239c88f3b03aa4c907a60d6))
* fix and cleanup workspace settings ([1457b04](https://github.com/wygoralves/panes/commit/1457b043e2e72125b6bcf4b6032d6a84f45a569a))
* front the permission picker with autonomy presets ([3013369](https://github.com/wygoralves/panes/commit/3013369dfb43e87d6767c1b8a994a953d94daca3))
* **git:** add Fetch All and Pull All for multi-repo mode ([dcada1c](https://github.com/wygoralves/panes/commit/dcada1c1806c849034fb0be5fecf4c6673696357))
* **git:** add MultiRepoChangesView with accordion pattern ([691a277](https://github.com/wygoralves/panes/commit/691a277fd86e78c58ef37925d10b57a9f3cff193))
* **git:** add per-repo more menu with pull, push, undo last commit ([9f8b30e](https://github.com/wygoralves/panes/commit/9f8b30e063be868fb662caa866ad5c28a9df436d))
* **gitpanel:** improve logic of dropdown opening of the gitpanel ([a04b54d](https://github.com/wygoralves/panes/commit/a04b54d1abaebd298a87d882f475d3b90f463763))
* harden claude integration ([ffcfacf](https://github.com/wygoralves/panes/commit/ffcfacf6822b69d36a8a6769c1b7e4c4b4da89a6))
* harden Codex thread policy handling ([0613fb8](https://github.com/wygoralves/panes/commit/0613fb8b74bc92b602e6bcccc98aa7fedb4e1027))
* improve branding on chat components ([7b30b10](https://github.com/wygoralves/panes/commit/7b30b10ed8adef858ab31e89aff6171ad515161e))
* improve expandable components experience ([2c36088](https://github.com/wygoralves/panes/commit/2c360881680bcde71b2a7a61e8a4d2bf03a7c6e6))
* improve file link navigation ([773687b](https://github.com/wygoralves/panes/commit/773687b72d387bc498d54a7730281d3bbd74527b))
* improve focus logic on split panes on tui ([b0771a5](https://github.com/wygoralves/panes/commit/b0771a5843ff7a6c378f012aa9ee9e2864229185))
* improve message load on front and backend and improve stability of codex in sandboxed environments ([5522aac](https://github.com/wygoralves/panes/commit/5522aac8107f64f28717dac3f9f2158b987b6040))
* improve organization of the settings dropdown ([726f3d5](https://github.com/wygoralves/panes/commit/726f3d5b0a6eb554231a11af687a00de1e57f90f))
* improve overall UI of header and sidebar ([0ab884f](https://github.com/wygoralves/panes/commit/0ab884f8b1992825f0d516c730122c3c756c7979))
* improve terminal persistance stability between workspaces ([794037a](https://github.com/wygoralves/panes/commit/794037a5bc2888f0856dd0b91d4511621262fa97))
* improve terminal tab naming logic for native harnesses ([de9d2ef](https://github.com/wygoralves/panes/commit/de9d2ef66cc4707d265517e54bd944db54de1d03))
* improve UI display of plan, attachments and limits ([43c2a51](https://github.com/wygoralves/panes/commit/43c2a5124ada9da87f7170029b5b965b96bfb713))
* improve UI for chat components ([867def4](https://github.com/wygoralves/panes/commit/867def4397c3cad4e3ea71332653af8f4b5aac66))
* improve ui for focus mode on chat view ([aa0fac0](https://github.com/wygoralves/panes/commit/aa0fac06478903550111d34718b48497ab40944d))
* improve UI for permissions ([5ec8d88](https://github.com/wygoralves/panes/commit/5ec8d885218e5966670218e08d9717cafb711f17))
* improve UI for permissions dropdown ([81c40f6](https://github.com/wygoralves/panes/commit/81c40f62a279e31dc796d8d8316e1d25024edff1))
* improve UI for search and command palette ([1ffc985](https://github.com/wygoralves/panes/commit/1ffc985bfb8c5c3cf479b4ea51e9a6a52fdd6540))
* improve ui for workspace settings ([d8ea234](https://github.com/wygoralves/panes/commit/d8ea23420f8bbd847d80f18d155c7ece33a68e47))
* improve ui of git panel more options ([a479c53](https://github.com/wygoralves/panes/commit/a479c53094c384c2125d543560cdac105556e748))
* improve UI of opening new projects ([7229716](https://github.com/wygoralves/panes/commit/7229716297c7c82a066447c89b94dca2b6c0999a))
* improve UI of the model and engine picker ([18cdea6](https://github.com/wygoralves/panes/commit/18cdea6f71fdf7137c309fd072a6172da61e327d))
* improve usability for the workspace setup ([6481236](https://github.com/wygoralves/panes/commit/6481236115a9b9c7702ec65c36a874c7f42e368b))
* improve window visuals for linux ([090a1fe](https://github.com/wygoralves/panes/commit/090a1fe0a82498cc959694be6482216e0aa38e46))
* let toasts carry a title, wrapping body, and action ([91a94f2](https://github.com/wygoralves/panes/commit/91a94f27d94fe4f697c0443a534bb36141a4738e))
* **linux:** add Debian updater target and Linux CI smoke test ([9138892](https://github.com/wygoralves/panes/commit/91388924b909a38edeab3c5411054d6d19723a34))
* make approval requests readable in the composer banner ([ae086bc](https://github.com/wygoralves/panes/commit/ae086bc429e459a3e90b9e0734eff03838466b4c))
* more performance and responsiveness improvements to the chat panel ([ab7a5b6](https://github.com/wygoralves/panes/commit/ab7a5b695c216dcb0c8b71b3f5cc7a6455252ee0))
* move workspace search into command palette ([c4c5c83](https://github.com/wygoralves/panes/commit/c4c5c830cd5fb35d9ae5befd0d8dc3598e0f810d))
* **nav:** add smart compress expand for git and nav panels ([ce94bc1](https://github.com/wygoralves/panes/commit/ce94bc1b4cf93e36c3a520aab4cb987decfb6850))
* **nav:** improve file management and opening in the file editor ([1cfe26d](https://github.com/wygoralves/panes/commit/1cfe26d3806e72bdef66267ec3da81788d8c623d))
* **notifications:** add chat notifications ([c8823f3](https://github.com/wygoralves/panes/commit/c8823f34f971a3238d286032d50a2fb6eeb95fdc))
* **notifications:** add interface and configs for notifications on terminal ([4f9a907](https://github.com/wygoralves/panes/commit/4f9a907b5dbc30e960e762560b0f15f2dbb10507))
* **notifications:** add sound settings for notifications ([31ded95](https://github.com/wygoralves/panes/commit/31ded9585d57aa86019b7ba565d285d056bf3147))
* **notifications:** improve ui for notifications ([2c0380b](https://github.com/wygoralves/panes/commit/2c0380b18af05c896b6c178cca8f5e59d1f4f4ff))
* **onboarding:** add finishing touches to panes onboarding ux ([f511cb1](https://github.com/wygoralves/panes/commit/f511cb19b47f0dfe11b7d10171bb9dffb2721e41))
* **onboarding:** add onboarding state foundation ([e6fea46](https://github.com/wygoralves/panes/commit/e6fea46854184df4a7c48ce696384a69f70d1ea0))
* **onboarding:** improve visuals of the onboarding flow ([d79125a](https://github.com/wygoralves/panes/commit/d79125a87af3ec3e56eab264dbeb70fba8b7f06f))
* **onboarding:** more  finishing touches to panes onboarding ux ([374fa89](https://github.com/wygoralves/panes/commit/374fa8925c115a250b2fa66302a2d535885bd515))
* **onboarding:** more ui improvements to the onboarding flow ([c3e0e61](https://github.com/wygoralves/panes/commit/c3e0e612a97f47fc7c89ecacfde031586c8262fb))
* **onboarding:** more ui improvements to the onboarding flow ([edf30db](https://github.com/wygoralves/panes/commit/edf30db66298985dfec8344aeeb57acf0a99c885))
* **onboarding:** more ui polish and i18n fixes  to the onboarding flow ([5f52438](https://github.com/wygoralves/panes/commit/5f52438bf8b069e31817fc8a3d2d6bdee93d3a28))
* **onboarding:** unify first-run onboarding flow ([f5a2b65](https://github.com/wygoralves/panes/commit/f5a2b65effc7bb93c95c103a81f96db75137ce83))
* **opencode:** add backend engine ([2c264e2](https://github.com/wygoralves/panes/commit/2c264e245486087a39f015bf677f14dd63a41aca))
* **opencode:** add frontend chat support ([da20c42](https://github.com/wygoralves/panes/commit/da20c42b5690ea8658e3d98c1adc90a2fd8306c7))
* **opencode:** add model attachment metadata ([7250bde](https://github.com/wygoralves/panes/commit/7250bde00f2b105bbe43d4a53deec7d4296cb17b))
* **opencode:** add session lifecycle tools ([e46b89f](https://github.com/wygoralves/panes/commit/e46b89ff91880c6957214c47db0bd3f92f1c8d3c))
* **opencode:** expose reasoning variants ([215d9f8](https://github.com/wygoralves/panes/commit/215d9f82cdac71108675a625dad1a24da0993496))
* **opencode:** expose runtime controls ([ad3b5f1](https://github.com/wygoralves/panes/commit/ad3b5f16c897899413bbec593df4f909f9541b70))
* **opencode:** improve model picker and approvals ([99e1fc1](https://github.com/wygoralves/panes/commit/99e1fc1271d409850f5b2b9f49047a598504f526))
* **opencode:** improve usage and question handling ([a9bbff8](https://github.com/wygoralves/panes/commit/a9bbff85fe0b6aea6a496b609e030ac5b0dd8d8d))
* optimize terminal buffer, chat rendering, and editor cache ([fe27d01](https://github.com/wygoralves/panes/commit/fe27d01bae815de89cd256a3e4027d77ebef78c2))
* overall layout adjustments for git panel ([72121ab](https://github.com/wygoralves/panes/commit/72121abae823cdf570cbb252826d0e68c3e3d3a4))
* overhaul workspace settings ui ([4e6e6df](https://github.com/wygoralves/panes/commit/4e6e6df841358efa78c4e14e2c69ab612568c3cc))
* **packaging:** add experimental flatpak manifest and mise install path ([2197b34](https://github.com/wygoralves/panes/commit/2197b34cce244f76abd6d514991d7a0349660bcc))
* performance improvements on the chat panel ([5b0fb3e](https://github.com/wygoralves/panes/commit/5b0fb3efbb68f3747d550b9b3098b9deacf32e60))
* polish and conclude agent harnesses experience ([ec773c3](https://github.com/wygoralves/panes/commit/ec773c370dd8b27a5222afc827015c70fb440a2a))
* polish UI of the approval banners and harden claude sdk integration ([cf2e6ed](https://github.com/wygoralves/panes/commit/cf2e6ed6f3f45fd69fb65f405d0fa230b4c8de38))
* **power:** add clamshell lid-close sleep prevention via privileged helper ([9dc098e](https://github.com/wygoralves/panes/commit/9dc098e28b556d597c05248a11f3a17756c12f22))
* **power:** adjust time picker for session duration ([4cf22e4](https://github.com/wygoralves/panes/commit/4cf22e4a38a59851beb6b3fca7b0f78dc28daf80))
* **power:** harden macOS keep-awake backend ([d7e8dc1](https://github.com/wygoralves/panes/commit/d7e8dc17865c8a96145a521b60e31b48a9ce2f38))
* **power:** implement advanced power management settings ([70201d4](https://github.com/wygoralves/panes/commit/70201d4bcd478334c3f9ac349205650566cf4380))
* **power:** replace caffeinate with direct IOKit assertions on macOS ([1d4b739](https://github.com/wygoralves/panes/commit/1d4b7397d5fd082296e65fbe5fce5f65d7dc53d7))
* preserve selected repo when moving across workspaces ([ee78ceb](https://github.com/wygoralves/panes/commit/ee78cebe9c9f06ab3945019d94da916f605905b7))
* properly wire plan, monitoring and attachments to codex app server ([0025f0d](https://github.com/wygoralves/panes/commit/0025f0da129e4d591e281c141ac5ef7adea36ec7))
* publish Homebrew cask for releases ([4327c6a](https://github.com/wygoralves/panes/commit/4327c6a85731b0328c684d208d844290a97121d2))
* publish redesigned Panes landing page ([2171345](https://github.com/wygoralves/panes/commit/2171345dcebac5ee163828ae4517f6eb2727c43f))
* refine layered workspace surfaces ([5c92119](https://github.com/wygoralves/panes/commit/5c92119049c4c4f3adcbc70bb5ee592bff775062))
* replace Panes application icons ([723d97d](https://github.com/wygoralves/panes/commit/723d97d2bda5f736632584da2b4c5f840355f674))
* rework message blocks onto the shared block grammar ([53a9e98](https://github.com/wygoralves/panes/commit/53a9e989dec604ea4faef6dbe61e2f198ddd96a8))
* **sidebar:** add shortcut actions and hints ([2ff0d2c](https://github.com/wygoralves/panes/commit/2ff0d2c35c6e181badfbe0b6dd8f5620a7a68cad))
* **sidebar:** refresh workspace navigation ([f6f681c](https://github.com/wygoralves/panes/commit/f6f681cd9239b070ff344e0bdec03a045c51310a))
* some more ui updates for permission policies ([98007f0](https://github.com/wygoralves/panes/commit/98007f00d90474e01c01ef9e6f27715eb01e1f67))
* surface background approvals and default autonomy ([c4bd0e6](https://github.com/wygoralves/panes/commit/c4bd0e681e5200966d8feb85ced6cb000b8e9ec4))
* surface model reroutes and MCP progress ([34b3b1d](https://github.com/wygoralves/panes/commit/34b3b1dad85640e6ac7f99b7b320e40e54a8f7c1))
* **terminal:** add Claude notification hooks ([903d821](https://github.com/wygoralves/panes/commit/903d821a709cfd90a72a727abd29e3e25fedf827))
* **terminal:** add Codex notification bridge ([2bce37e](https://github.com/wygoralves/panes/commit/2bce37e48357d658ddebad09a282d61d4e16b020))
* **terminal:** add configurable terminal font size ([b8bc883](https://github.com/wygoralves/panes/commit/b8bc883fc6229eb81246d40f2ec62f6dd521da35))
* **terminal:** add notification ingress foundation ([2370b76](https://github.com/wygoralves/panes/commit/2370b76d5f44d0f51bbe9eaf0839a3815a35a16f))
* **terminal:** add OSC notification fallback ([d6e071b](https://github.com/wygoralves/panes/commit/d6e071bf62dd086d0158b3c6b8e5068cc27a074a))
* **terminal:** wire notification state into terminal UI ([4add872](https://github.com/wygoralves/panes/commit/4add872d8e3498b91d60eb7b1efeb52de0edc900))
* track application update progress ([1a7716d](https://github.com/wygoralves/panes/commit/1a7716d0a2266329cc997d4f83081687f38d7500))
* **ui:** add light mode theme ([83ff860](https://github.com/wygoralves/panes/commit/83ff860a13cd50c77e72cbdc85092297cc8018aa))
* update terminology for stage related actions in i18n ([cc3fbc6](https://github.com/wygoralves/panes/commit/cc3fbc60f56abe5ab7fd6df3f40acf8640f794a3))
* update visuals for bar ([1225abc](https://github.com/wygoralves/panes/commit/1225abca024cfecd0f974904fb2a594a43c19487))
* update visuals for custom linux bar ([d10aec7](https://github.com/wygoralves/panes/commit/d10aec73e4f486e2167835d4b243e69da2acee2e))
* **windows:** add keep awake backend support ([4b9176d](https://github.com/wygoralves/panes/commit/4b9176de49118d2680c618ab79750ab813e90daa))
* **windows:** add release pipeline and updater assets ([d378808](https://github.com/wygoralves/panes/commit/d378808c64dba22e600f6974bf528862f6f83d0a))
* **windows:** detect terminal foreground harnesses ([20656fa](https://github.com/wygoralves/panes/commit/20656fa6bbb3d99df05676347e826e6e7d642a09))
* **windows:** fix fmt issue ([62fc173](https://github.com/wygoralves/panes/commit/62fc173443cd70f4b969216a23364fe3ba56173b))
* **windows:** fix more ci issues ([6f9428d](https://github.com/wygoralves/panes/commit/6f9428df7477b063bf5556f86aec43c8b3e637a6))
* **windows:** fix ts errors ([eb6c927](https://github.com/wygoralves/panes/commit/eb6c92795b00c9a5fcc489e44716eb37f5ec206b))
* **windows:** gate unsupported keep awake controls ([28374d8](https://github.com/wygoralves/panes/commit/28374d89dd8971e009a2d00220e314b8ead269a9))
* **windows:** harden reveal path selection ([b036146](https://github.com/wygoralves/panes/commit/b036146b881cd1ac42268c5d1b8e9a5d384bc43a))
* **windows:** harden terminal env and harness onboarding ([9f0e888](https://github.com/wygoralves/panes/commit/9f0e888c0d0dc572a1164b602902119629b6c5b6))
* **windows:** improve engine health guidance ([3ea0103](https://github.com/wygoralves/panes/commit/3ea01034894e0fd2000598737561d637a5bd7f08))
* **windows:** normalize app data and setup discovery ([5526f33](https://github.com/wygoralves/panes/commit/5526f339f39879fc30c200002c44ccdb1d3ac3a8))
* **windows:** unify custom window chrome on Windows ([be00462](https://github.com/wygoralves/panes/commit/be004625c52715a68f1adae91b177331a452d31f))
* **windows:** update docs to warn rough edges on windows first release ([bfac230](https://github.com/wygoralves/panes/commit/bfac23013dc1b33d0493dcce5c5262b51bc0288e))
* **workspace:** add a discoverable file plus chat split view ([4f70cec](https://github.com/wygoralves/panes/commit/4f70cec2c3bf81a2241e6610c7b22ee143a932a9))

### Bug Fixes

* add diagnostics for debugging complex tui rendering ([77177b2](https://github.com/wygoralves/panes/commit/77177b2a684a457614966a6a97532f910f743d19))
* add fallback to prevent crashes on cosmis ([d5f47bc](https://github.com/wygoralves/panes/commit/d5f47bce50a03556ebc67782209b78e7091f58a8))
* add more diagnostics and fallback logic for sandboxing ([86a1610](https://github.com/wygoralves/panes/commit/86a1610d17928ffe41414b87d1854c014c36c0ee))
* add more diagnostics for fixing complex tui rendering and caps for memory consumption ([119ba81](https://github.com/wygoralves/panes/commit/119ba8123855f608b96cd9a7d1c924874b7685f6))
* add more diagnostics for handling more complex tui aplications ([8925e37](https://github.com/wygoralves/panes/commit/8925e373c208841b3d7f284e00b60a3f6c29cd41))
* add more diagnostics for terminal frontend hanging ([2de5578](https://github.com/wygoralves/panes/commit/2de557841ee0f8184e81610452715e7664bac6d9))
* add more diagnostics to complex tui rendering ([55482a3](https://github.com/wygoralves/panes/commit/55482a3b306fbf5de76ece62f74a94106a994199))
* address code review findings on notifications ([d391d17](https://github.com/wygoralves/panes/commit/d391d17fb9db17ef109acd9e07ed252dc14ab8cd))
* adjust layout when rail sidebar is hidden ([3cbc597](https://github.com/wygoralves/panes/commit/3cbc5974c9d6ddb8ac14a63857573c8d19227509))
* adjust padding of the gitpanel ([e4b1db5](https://github.com/wygoralves/panes/commit/e4b1db55eb6f0aac71c97fcecf60937e205f778c))
* avoid selfdeadlocking on app config ([92d3829](https://github.com/wygoralves/panes/commit/92d3829b7c6b94cd1895fad30ef0a2c7c85eab2a))
* avoid terminal process lock contention ([3346ec3](https://github.com/wygoralves/panes/commit/3346ec35d15c924af6225d79fa4f0ff42a6cf464))
* avoid transient appimage workspaces on linux ([baae375](https://github.com/wygoralves/panes/commit/baae3752f06b8bb89cf000fd30fd13a14ae50468))
* bound unterminated terminal OSC sequences ([070b4bd](https://github.com/wygoralves/panes/commit/070b4bd5d33f65ed3843beca800d1eac337ff6a4))
* **chat:** address more edge cases on planning handoff ([a4b9b11](https://github.com/wygoralves/panes/commit/a4b9b1196fa84295227f2a6db5dff0810621d7aa))
* **chat:** adjust and fix plan-mode handoff flow ([30c5a5d](https://github.com/wygoralves/panes/commit/30c5a5d47b26aebf89eaf08f92354666eb6bdd6b))
* **chat:** better handle malformed percent encoding in file links ([f5e65b3](https://github.com/wygoralves/panes/commit/f5e65b3df2e36578413fe7edec32e4c16b90891e))
* **chat:** collapse duplicate diff blocks ([841c7a3](https://github.com/wygoralves/panes/commit/841c7a3f4e0196f9dda0abdd1d0a94374bef12b8))
* **chat:** fix codex initialization bug on chat ([98920a7](https://github.com/wygoralves/panes/commit/98920a7c569151633978b038307c8e0b3cef0aa9))
* **chat:** fix exitplanmode command for claude code ([a77386e](https://github.com/wygoralves/panes/commit/a77386ef72c7ead1823672ab26f0fc57f37439d6))
* **chat:** fix frontend losing track of active chats when switching between threads ([b9f0518](https://github.com/wygoralves/panes/commit/b9f051857c042c81320df4cbb101f7fb2bfa4bdb))
* **chat:** fix frontend race on codex plan execution ([9ce27e7](https://github.com/wygoralves/panes/commit/9ce27e7a4596dde201ed054da2df9d4d5dee24ab))
* **chat:** preserve layout on new thread ([03c7fe8](https://github.com/wygoralves/panes/commit/03c7fe8a3da07695c26bc696b5a88b72886bcc64))
* **chat:** reduce model picker visual noise ([f17166c](https://github.com/wygoralves/panes/commit/f17166c19edccc229e081e0520ab48152e50468e))
* **chat:** some more adjustments to the plan handoff to execution mode ([7f597f0](https://github.com/wygoralves/panes/commit/7f597f078a146c51e8514497207a2edaba7d28d4))
* **ci:** harden release bundles across platforms ([a840bd5](https://github.com/wygoralves/panes/commit/a840bd59bdd3efbe0e52d36086386dce945c673e))
* clarify OpenCode chat support ([d942bad](https://github.com/wygoralves/panes/commit/d942bad515c68565405eeae0cddb5556987d79cf))
* **claude:** emit stop-reason notice before turn completion ([864bc61](https://github.com/wygoralves/panes/commit/864bc6124d5e7cffa197dc2cd4e9bef44bce5fe5))
* **claude:** fix bundling on prod build to restore claude sdk functionality ([b761210](https://github.com/wygoralves/panes/commit/b761210b85665352c436b6d2cedd450925096615))
* cleanup orphan terminal sessions when exiting app ([1ef6f73](https://github.com/wygoralves/panes/commit/1ef6f739e9dbf1c47384491a1005cc94db640636))
* cleanup unwanted diagnostics and ship fix to more complex tui not rendering correctly ([67cec23](https://github.com/wygoralves/panes/commit/67cec2311c2d8192b7a755c2a2d6099c7ecac325))
* close Claude parity gaps ([dcab811](https://github.com/wygoralves/panes/commit/dcab8115950cace274e24b4bcb3f4319118c9c4a))
* **codex:** align Codex context meter semantics ([55db629](https://github.com/wygoralves/panes/commit/55db629b9bde97d0d7b3bf6e2b26ebf5e5879b0e))
* **codex:** align live notification method shapes ([cd05c43](https://github.com/wygoralves/panes/commit/cd05c4355cba9d7b49ef120b64b14ddd31ebee49))
* **codex:** fix plan handoff and context calc on codex ([a6b2713](https://github.com/wygoralves/panes/commit/a6b2713b7196b021db9d4bca23595a9f5eadc143))
* **codex:** harden Codex reconnect recovery ([3b39343](https://github.com/wygoralves/panes/commit/3b393438ff2fffc719ddae87931232f81047d9c2))
* **codex:** harden Codex turn completion handling ([a233dbf](https://github.com/wygoralves/panes/commit/a233dbfb86092c250f4660a46e6829274ef88717))
* **codex:** surface unsupported external auth mode ([42b314c](https://github.com/wygoralves/panes/commit/42b314ce0942dbff9713d5b69cba38bf4208189c))
* **compatibility:** harden cross-platform tool and power detection ([9cf9717](https://github.com/wygoralves/panes/commit/9cf971749ecbb6b03e4e8406fdc18ba2813f9b59))
* **compatibility:** normalize persisted Windows workspace roots ([b1a7cc7](https://github.com/wygoralves/panes/commit/b1a7cc7c5bafa18eb5e34f6cc8d8126ba31e464f))
* **editor:** hide empty button container ([387fc55](https://github.com/wygoralves/panes/commit/387fc55669dc567f5a71d0dfb4ee8cce9f9f7b39))
* **editor:** open direct files without explorer ([3d3ead9](https://github.com/wygoralves/panes/commit/3d3ead90e78a1089f7afc8d531103e6ddea3d81a))
* **editor:** show external open action for all files ([e68fdfa](https://github.com/wygoralves/panes/commit/e68fdfabb221dfc418c1b06250e4a751f338cdfc))
* **editor:** stabilize explorer routing and state ([a8357d3](https://github.com/wygoralves/panes/commit/a8357d33f73cb202d5626a31cabf9e99a2508dfa))
* enable clipboard access on main webview ([06dd04a](https://github.com/wygoralves/panes/commit/06dd04ad31f4cfebca37cb11b0d9417a0783792d))
* **engines:** inherit login shell env ([413ca73](https://github.com/wygoralves/panes/commit/413ca739b6c0a92cd0d0447fcbc21228fc60026f))
* **explorer:** address final review findings ([ec640da](https://github.com/wygoralves/panes/commit/ec640da2dbb76ab078300d30361e26f60b5ba66a))
* **explorer:** cancel stale scheduled refreshes ([1596a5c](https://github.com/wygoralves/panes/commit/1596a5ce8475ea9bd19066fcc309bf5a4874c2c1))
* **explorer:** refresh stale directory state ([a3d10cf](https://github.com/wygoralves/panes/commit/a3d10cf07fbfcbc38d1152fecc3d7fb9f0ad5778))
* **files:** search workspace filenames from cache ([d1f1bcc](https://github.com/wygoralves/panes/commit/d1f1bcc69035eed3a0e5e609b764e5e1f8ac65e0))
* **filesystem:** reject unresolved create paths ([646ff31](https://github.com/wygoralves/panes/commit/646ff311e83ddfa2d8c6627e130aaed51fa40062))
* fit model controls in narrow panes ([5b679d7](https://github.com/wygoralves/panes/commit/5b679d7a53103d4a02c3ab55c19069b894693d1f))
* fix alignment and update logo on rail sidebar ([4958905](https://github.com/wygoralves/panes/commit/4958905ae75a5ed5c328953838de2c0032d3ba5b))
* fix approval banners not resolving correctly ([8d06634](https://github.com/wygoralves/panes/commit/8d06634ac24e330a35d0bdb0c326a3c0b4954f2e))
* fix backend issue for window controls ([7947c1b](https://github.com/wygoralves/panes/commit/7947c1b50c3f3f76f3a252275748c818f35231a7))
* fix chat titles not being correctly shown ([ae9dfa1](https://github.com/wygoralves/panes/commit/ae9dfa1e0bca57f61d0cbf3964b27417964e9233))
* fix ci breaking issue and fix cancel i18n tags references ([a3612f2](https://github.com/wygoralves/panes/commit/a3612f27489d167e1a817efbaab6ee6a31ed8a27))
* fix clickable area of buttons ([a2714bc](https://github.com/wygoralves/panes/commit/a2714bcb27c1e2908c809c771c47a5b185287e95))
* fix config write races and Linux window decoration persistence ([d5900b4](https://github.com/wygoralves/panes/commit/d5900b4df4efeecd154eabfc666309336753485b))
* fix copy diagnostics constraint on prod build ([0756331](https://github.com/wygoralves/panes/commit/0756331dbb7bbd4ed41e0425ebbc510744a35aa4))
* fix factory droid and kiro places in lp and adjust harness logos ([0598ab6](https://github.com/wygoralves/panes/commit/0598ab65b31f8d24d18233d1f23199de45a5f3b4))
* fix incorrect harness commands for kiro and droid ([cee074d](https://github.com/wygoralves/panes/commit/cee074d7048d8899490eb16f32d964e4aadaa1f1))
* fix limits strings not being replaced ([85b2863](https://github.com/wygoralves/panes/commit/85b2863303727100aa660630390c62dd109f4f54))
* fix lp logo not refreshing ([4a49d35](https://github.com/wygoralves/panes/commit/4a49d350b08226056fda9b53334205fab5c3db11))
* fix macos build crash ([d0c8c6a](https://github.com/wygoralves/panes/commit/d0c8c6a9f200fef97dea04a6e1609f6c3e8957e0))
* fix macos release smoke false negative ([d9a8c83](https://github.com/wygoralves/panes/commit/d9a8c83ae9715d0477ba776c16259ad6ef754e2a))
* fix path for correct running of claude sidecar ([ad37a53](https://github.com/wygoralves/panes/commit/ad37a53a5cf5f719e78ae5f810b90092ef7bd6d4))
* fix plus button losing dom focus on terminal pane ([c9f7ab0](https://github.com/wygoralves/panes/commit/c9f7ab092a2958e10b68e4efeb07441136218651))
* fix possible regressions on other places native commands on linux ([37b4fef](https://github.com/wygoralves/panes/commit/37b4fef86ab87c386e3b7c55ff99e025bc7eef54))
* fix possible sandbox broken fallbacks and codex setup health check ([98d855c](https://github.com/wygoralves/panes/commit/98d855cf9f7caf25b26c2d8333f1853585895792))
* fix race conditions for terminal and editor views not triggering on some cases ([d341ead](https://github.com/wygoralves/panes/commit/d341ead3f146d9395c5b992e5e51bb30a0cb8f27))
* fix regressions brought by custom window decoration ([8848c84](https://github.com/wygoralves/panes/commit/8848c84f52e75197bcf447496ebe87ea438d3e20))
* fix renderer hydration regression ([e1c153f](https://github.com/wygoralves/panes/commit/e1c153f06bffe40877fbee394a0e9a24e0ac15d6))
* fix restrictions getting in the way of codex calling tools ([34cd570](https://github.com/wygoralves/panes/commit/34cd570206ca9ef487ddf7630e10d37564433c28))
* fix review findings ([1150964](https://github.com/wygoralves/panes/commit/1150964f5b5f293ae579681769ef92a7b4c9e6d9))
* fix stale codex models effort when resuming threads ([a82e742](https://github.com/wygoralves/panes/commit/a82e742338de148914665ce20e2cacac4823260a))
* fix stale data from git internals not showing in the git panel ([0585461](https://github.com/wygoralves/panes/commit/05854612dfe490287aa0ef9c2313bc11cc22e5fc))
* fix stash not properly showing in stash tab ([1120560](https://github.com/wygoralves/panes/commit/1120560c5f34fa292f5f746d5abe4873ce7a1ddd))
* fix terminal initialization sync on app opening ([f2db5c9](https://github.com/wygoralves/panes/commit/f2db5c9384af4c2ef135eca8d30643ab56b2b7b3))
* fix UI styles for manage remotes dialog ([74b5090](https://github.com/wygoralves/panes/commit/74b5090f2a0df656f48609245c09ac89b70751f9))
* fix window controls on linux custom bar ([890b275](https://github.com/wygoralves/panes/commit/890b27510d97b22c2f5b1eef91badee50966aeef))
* **git:** address Codex review — stale status, directory discard, per-repo commit ([2cc6691](https://github.com/wygoralves/panes/commit/2cc6691bdb8c604957156226959ea1453d74e3db))
* **git:** align more menu in multi-repo mode and spin RefreshCw during fetch all ([93c3f68](https://github.com/wygoralves/panes/commit/93c3f6870dd2b853be147fb619d853c875e39add))
* **git:** align panel pin icon ([c52d5df](https://github.com/wygoralves/panes/commit/c52d5df209f395b0bdf80c540189de700c176caa))
* **git:** hide branch meta and repo picker in multi-repo changes mode ([8eec8ce](https://github.com/wygoralves/panes/commit/8eec8ce3cb3990a79d91c18c4faaa7f686a64d90))
* **git:** keep flyout open for internal clicks ([6406888](https://github.com/wygoralves/panes/commit/6406888fb7d07b18deeeac3d9b5c0bc135445a9b))
* **git:** keep multi-repo changes view in sync ([7222ad4](https://github.com/wygoralves/panes/commit/7222ad48a87f852ab5109e10b76e82fcf9684a86))
* **gitpanel:** fix git panel collapsing incorrectly in some scenarios ([e585055](https://github.com/wygoralves/panes/commit/e5850552f829b0a9a94824a23e25eb7ff12c6b05))
* **gitpanel:** properly show fullscreen dialog when discarding git changes ([91223b4](https://github.com/wygoralves/panes/commit/91223b4f73435efc6e0febbb74dbdf9aecdce287))
* **gitpanel:** restrict repo-scoped git picker to active repos only ([1d5278a](https://github.com/wygoralves/panes/commit/1d5278a33a25a93d250cc780a86345c581bfa41e))
* harden Git checkout and discard flows ([bbf44f3](https://github.com/wygoralves/panes/commit/bbf44f35521e2460366bd6a410144a55505b1413))
* harden keep-awake error-state handling ([c09c2fe](https://github.com/wygoralves/panes/commit/c09c2fedfbb5e6b7ac0c2a615624a45921fef179))
* harden keep-awake helper lifecycle ([e646c6c](https://github.com/wygoralves/panes/commit/e646c6cc9e447404f240858cae4d8dc9ee4b532a))
* harden keep-awake state persistence ([d94dced](https://github.com/wygoralves/panes/commit/d94dced0e6bf8d3b744affa735f3fb3340cb5522))
* harden keep-awake state transitions ([ce98a60](https://github.com/wygoralves/panes/commit/ce98a604627a4ebb1d05cb13670448d79534a6bc))
* harden permission flows for codex execution ([e67a950](https://github.com/wygoralves/panes/commit/e67a950ba7f689409daefcd4646f2bd1f17bf32d))
* harden rust helper persistance and fix frontend state errors ([4807f5f](https://github.com/wygoralves/panes/commit/4807f5fa902d7cbe6e82474ea146b8c94a74e061))
* **harness:** add Antigravity CLI harness, mark Gemini CLI enterprise only ([55240db](https://github.com/wygoralves/panes/commit/55240dbe5d3c93d3c049ee1b29a1da40f515b5ba))
* **harnesses:** fix install command for opencode ([6cc1490](https://github.com/wygoralves/panes/commit/6cc14905f5beab31359f44a16ba7ae8583067aa9))
* **harnesses:** harden PATH fallback config parsing ([659ecd5](https://github.com/wygoralves/panes/commit/659ecd5325c483111e1be27108cff6a3e8f90990))
* **harness:** remove emdash from Antigravity logo comment ([b9fc2c3](https://github.com/wygoralves/panes/commit/b9fc2c34a8319093909a4fe0c691fa5bc53f6e1e))
* index assistant replies in global search ([5d1f8f2](https://github.com/wygoralves/panes/commit/5d1f8f28d10e404e14fcacdce62bbc31f5fb8851))
* install both darwin arches for the universal sidecar build ([09d8f6e](https://github.com/wygoralves/panes/commit/09d8f6e2475729a495ee41070dbdc2f516121b49))
* **linux:** address ui freeze on appimage build ([6d64b7e](https://github.com/wygoralves/panes/commit/6d64b7eabc62e8a35a4e053affd3af6f232e94b4))
* **linux:** apply EGL/DMABUF webview workaround to X11 AppImage sessions ([fab30a7](https://github.com/wygoralves/panes/commit/fab30a7566cc50dbb47cfa2f7f3f2d907584477b))
* make the read-only preset copy match codex untrusted semantics ([074dac8](https://github.com/wygoralves/panes/commit/074dac8f3dec441ab744c00961cf863889192dd0))
* match Antigravity product icon color ([a78e6fb](https://github.com/wygoralves/panes/commit/a78e6fb9782d9e69a0ad10933e9e350a9a9a64cf))
* match terminal preview to app theme ([012064f](https://github.com/wygoralves/panes/commit/012064fe75df0a0641a1769aa725ed981a80ce12))
* **notifications:** decouple agent notifications from terminal startup ([1a9c0e7](https://github.com/wygoralves/panes/commit/1a9c0e749e6b25676310749d7584962434845f4b))
* **notifications:** fix stale ui state on notifications ([1765699](https://github.com/wygoralves/panes/commit/17656996fe539689a800d5ca601a5770e507fd37))
* **notifications:** play macOS preview sounds directly ([2ac9303](https://github.com/wygoralves/panes/commit/2ac9303b81fa9594a61349d9e2689f5eebe35319))
* **onboarding:** fix behavior regressions on onboarding flow ([324169e](https://github.com/wygoralves/panes/commit/324169e8472ce3adea9873eba15a557eb3958620))
* **onboarding:** fix persistance of chat harness selection and some windows bugfixes ([70b01cb](https://github.com/wygoralves/panes/commit/70b01cb8fea3480498d1bd958d38f00baabb484f))
* **onboarding:** harden install and reopen recovery ([bbaaaac](https://github.com/wygoralves/panes/commit/bbaaaac04d73fcb4cd3e700262b476782bd55c56))
* **onboarding:** serialize installs and readiness gating ([b244e98](https://github.com/wygoralves/panes/commit/b244e980e5c4355a57a70c2ff5f557ebd85f4bb1))
* open chat diff files at the repo-relative path ([00f545a](https://github.com/wygoralves/panes/commit/00f545aa1e3f3089b4798bfbea81ee4639a90093))
* **opencode:** composer reasoning fallback ([6a0983d](https://github.com/wygoralves/panes/commit/6a0983d575cd487aeae6f81052ee0492d7e298c5))
* **opencode:** permission mode resumes ([b8d25c3](https://github.com/wygoralves/panes/commit/b8d25c381ceaed2c4fce223a6abf12afa323cd2c))
* **opencode:** stabilize turns and idle memory ([eaeb91a](https://github.com/wygoralves/panes/commit/eaeb91ab219f1ae0b8b3aec753e952c8712850d0))
* **packaging:** address flatpak review findings ([f47dd70](https://github.com/wygoralves/panes/commit/f47dd704c9db877f925687c7da3d70479d44f30f))
* **perf:** another targeted perf tweak ([33e8063](https://github.com/wygoralves/panes/commit/33e80639a1248653a387a7701bfb14159563eea5))
* **perf:** bound completed terminal replay snapshots ([2d3704e](https://github.com/wygoralves/panes/commit/2d3704e72c8b0af936e527c440f567a0dc8d8d3f))
* **perf:** coalesce consecutive stream events in chat queue ([e932ee9](https://github.com/wygoralves/panes/commit/e932ee9e282ca98f32cfd4b303ba874448e15ea8))
* **perf:** first batch of perf improvements for reduced RAM usage ([3ade1da](https://github.com/wygoralves/panes/commit/3ade1da95f5ed2c1c843c57b114bf62c4587f5db))
* **perf:** store codex action details as raw json ([da63ae4](https://github.com/wygoralves/panes/commit/da63ae4de7650ba5cffe64acb0edb3f595303f3e))
* **perf:** trim large codex payloads at protocol boundary ([d7fff99](https://github.com/wygoralves/panes/commit/d7fff9985bd17af9e9ae0dc92cff233d2f4f9fca))
* polish landing page motion and alignment ([17cadc8](https://github.com/wygoralves/panes/commit/17cadc8783c5e010a7cdd1638e3147241da930e7))
* polish landing themes and bilingual copy ([77705da](https://github.com/wygoralves/panes/commit/77705daa62f4c35b64aba7e1a9f732249e0067df))
* **power:** add pmset fallback for lid-close prevention in dev builds ([02dc1d4](https://github.com/wygoralves/panes/commit/02dc1d4f3431e90d0f887c17ba3273feb3fa3f66))
* **power:** address code review findings ([7f96e66](https://github.com/wygoralves/panes/commit/7f96e6628aacaff4a9d1f3f1d58fb8a7efb8f394))
* **power:** address review findings for power management ([bc4c9d6](https://github.com/wygoralves/panes/commit/bc4c9d6b7b5035068dcb8d91f4cc4b28a0fd91bd))
* **power:** harden keep-awake power settings flow ([7c96f68](https://github.com/wygoralves/panes/commit/7c96f68887253fccd008a430705bbc463ade7662))
* **power:** include -s flag in default macOS caffeinate args ([48bdcf1](https://github.com/wygoralves/panes/commit/48bdcf1269eaf3875599a268bf9dacc3fa6f5cc4))
* **powermgmt:** align power status with runtime transitions ([45ba871](https://github.com/wygoralves/panes/commit/45ba87114bc97ec5066df89793886c88cf1ea609))
* **powermgmt:** harden power management state transitions ([c9d36b0](https://github.com/wygoralves/panes/commit/c9d36b0c268c8284358b319eef65c20ba087b77f))
* **power:** preserve platform-specific power settings semantics ([f16322c](https://github.com/wygoralves/panes/commit/f16322cfdf663fca31b1b7be55120b65545c73a9))
* **power:** receive monitor events without holding the runtime mutex ([025acc9](https://github.com/wygoralves/panes/commit/025acc962a5fa0c9ae57ca00b88fb43faedb6c52))
* **power:** reorder power mgmt menu sections ([32f9d11](https://github.com/wygoralves/panes/commit/32f9d11ec3efac432d67f8e114e3399932324626))
* **power:** wire PowerProfile through spawner and add Linux display inhibit ([d9207b1](https://github.com/wygoralves/panes/commit/d9207b161ca2c97882a24fde84cb3c1ff6f206e4))
* preserve legacy Claude thread models ([4f59e9e](https://github.com/wygoralves/panes/commit/4f59e9e3b3fbab544c3a2d4e0697e4d01802d7f5))
* preserve terminal shortcuts and robust shell probes ([a63155f](https://github.com/wygoralves/panes/commit/a63155fc0d6f46a8ce81cb2aa98edb528610ffaa))
* refine theme contrast and shell spacing ([7defb13](https://github.com/wygoralves/panes/commit/7defb1304e75524e292e7e55c52a0603c163708a))
* remove intrusive codex warning surfaces ([940364f](https://github.com/wygoralves/panes/commit/940364fbd0f3fb3234b91b49822c2f113f49e91f))
* remove unnecessary  window controls from gitpanel ([b439c75](https://github.com/wygoralves/panes/commit/b439c75829e47949e72cd0c23617cb1e991cb33a))
* remove unwanted divider on changes panel ([0ea6b84](https://github.com/wygoralves/panes/commit/0ea6b84314fd97e1f19de43a5ccbbc2e9fde0d4f))
* repair autonomy presets under external sandbox mode and picker layout ([fd1df7d](https://github.com/wygoralves/panes/commit/fd1df7d2e6f76f08d21ee0fe5c31824cc76cc55c))
* require disposable child process support ([ab268fb](https://github.com/wygoralves/panes/commit/ab268fbc7d7bf69264f81aeaecf8b80a78bd8335))
* require explicit Codex sandbox denials ([2c528e4](https://github.com/wygoralves/panes/commit/2c528e44fab67e7baad3b22b7fdbd22b0f45a3d6))
* reset stale Codex transport after auth failures ([46bddd9](https://github.com/wygoralves/panes/commit/46bddd9eb1dc055306213dbb029fa958d955a549))
* resolve external sandbox mode from the backend for autonomy presets ([009d5c1](https://github.com/wygoralves/panes/commit/009d5c11346930f508b501d2d0e18bda5a9c900d))
* restore and present provider usage limits ([d58b032](https://github.com/wygoralves/panes/commit/d58b032180bac878c23d54927830adebadd9ce7e))
* reuse desktop artifacts in release bundles ([b806730](https://github.com/wygoralves/panes/commit/b806730d4ac8e55f6d0ca0bcac4a319e81505987))
* select compatible Node runtime for agent sidecar ([c7ff573](https://github.com/wygoralves/panes/commit/c7ff5733c698c60be936ebf46faa50147b78c5b2))
* several fixes to the harness scanning and initialization ([7bbbc60](https://github.com/wygoralves/panes/commit/7bbbc60d6ab66bce56534b90d424e94674f13f78))
* **sidebar:** constrain expanded thread lists ([24611e1](https://github.com/wygoralves/panes/commit/24611e10c7bf179892c5fe3cc438e5aa4e0dfc18))
* **sidebar:** fix missing separator between actions and workspaces ([d56fbbe](https://github.com/wygoralves/panes/commit/d56fbbe2622c99e4b79c5ad7258502c1a0144f66))
* **sidebar:** fix visuals of the rail sidebar ([6402ced](https://github.com/wygoralves/panes/commit/6402ced80ca763b67390029852d16b8f321189e0))
* **sidebar:** open search palette from nav ([758b852](https://github.com/wygoralves/panes/commit/758b852506d7434ce80612f26ab1b3c24b96c3f8))
* **sidebar:** properly show compressed groups on startup ([978c333](https://github.com/wygoralves/panes/commit/978c333e3f984b7bea80e11c5aa29212983f575e))
* stabilize terminal bootstrap across workspace switches ([09245af](https://github.com/wygoralves/panes/commit/09245af3a0538e5e2323ec3dbf562e0a3a68f7e0))
* stage native agent runtime packages ([ac62f7d](https://github.com/wygoralves/panes/commit/ac62f7dc8c219395e80532b56bbeb98efbc616c9))
* **startup:** harden lazy startup without stale engine state ([4540ba1](https://github.com/wygoralves/panes/commit/4540ba1276f4f1f86d78f989f4ee20e4eee74dd1))
* stop panes wake lock when app is no longer running ([587d5ab](https://github.com/wygoralves/panes/commit/587d5ab81836140ebbf04d3d011e8315143f5412))
* **terminal:** add output backpressure ([01d47e7](https://github.com/wygoralves/panes/commit/01d47e7edb41e59401b312f633beb799eba4527a))
* **terminal:** address review feedback on font size setting ([e1e96ab](https://github.com/wygoralves/panes/commit/e1e96ab7043d2f2764e209f27d56ebfca89da72a))
* **terminal:** preserve notification hydration ordering ([bc9922f](https://github.com/wygoralves/panes/commit/bc9922fe1989042ab2c7eb542168b19a5e0e3c04))
* **ubuntu:** fix regression caused by changes on claude sidecar bundling ([fc6db62](https://github.com/wygoralves/panes/commit/fc6db62fa613df75d44ef8e494ac0107ca451e5b))
* **ui:** fix light theme regressions, contrast, and remaining dark surfaces ([d33db4a](https://github.com/wygoralves/panes/commit/d33db4a2aa54dec050e5f93ae8ebd9934c55130c))
* **ui:** refine sidebar thread actions ([7476ab8](https://github.com/wygoralves/panes/commit/7476ab8bf4f638d5f3d92d13470ae1bb65667a3e))
* update codex schema parity check ([caf5911](https://github.com/wygoralves/panes/commit/caf591132f0d9007abd2572c75581b4fb484e60e))
* use official Antigravity CLI logo ([1b28620](https://github.com/wygoralves/panes/commit/1b28620b69244d0f41889a018220200ac43e58e9))
* **windows:** avoid install dir as default workspace ([4840365](https://github.com/wygoralves/panes/commit/4840365b529db7512c690db603922f0bb91e08f6))
* **windows:** harden update manifest generation ([86d03d3](https://github.com/wygoralves/panes/commit/86d03d3b0acc922f5cac2e0922fa836dc597f75f))
* **windows:** improve manual setup guidance ([f229bfe](https://github.com/wygoralves/panes/commit/f229bfe489d268b9f3ae6ad528f1f5edb24fa98e))
* **windows:** migrate app data and harden defaults ([838347f](https://github.com/wygoralves/panes/commit/838347f0836305ac8a0f3bbb8d849685ffd0bc02))
* **windows:** remove macos-only app menu items ([d189b66](https://github.com/wygoralves/panes/commit/d189b66f71f0925421febd214ead9b59cf22ae2b))
* **windows:** tweak ci scripts for windows build ([85c90d1](https://github.com/wygoralves/panes/commit/85c90d12e185a6473d8b5a11e255ff08d088c22b))
* wire terminal clipboard shortcuts ([c7afca5](https://github.com/wygoralves/panes/commit/c7afca5cf2dce9def67303a616cd7e5ce02a6ac0))
* **workspace:** preserve source pane for file links ([a118fa4](https://github.com/wygoralves/panes/commit/a118fa4c72d090ff08e29aa3c82e1d61a148be71))
* **workspace:** reserve space for the split button over the tab bar ([363b936](https://github.com/wygoralves/panes/commit/363b9362b0e5d5b1cfa33ddc3a8148ebe356f310))
* **workspace:** tokenize the split button chip colors for light mode ([6a62a01](https://github.com/wygoralves/panes/commit/6a62a010f4dfa3af9d1a5844630f4151e9849970))

### Performance Improvements

* make chat submissions responsive ([1f93700](https://github.com/wygoralves/panes/commit/1f937001eaaf7893b84a72440aa998b551a4d1ac))

## [](https://github.com/wygoralves/panes/compare/v0.62.2...vnull) (2026-07-13)

### Features

* add an autonomy preset ladder for chat execution policy ([1312a92](https://github.com/wygoralves/panes/commit/1312a926d9034800b9992fe3a707d615fcc576f1))
* add en and pt-BR copy for the chat component rework ([0129040](https://github.com/wygoralves/panes/commit/012904026adfb3d49a69bc84de056cde4d6ddb78))
* add per-harness launch flags to the agents menu ([601d908](https://github.com/wygoralves/panes/commit/601d9084e6d30ad705d7c51a6b9a56a351d0b2b6))
* add unified chat component styles ([5a3eaa5](https://github.com/wygoralves/panes/commit/5a3eaa5c049ddda65860d621511a3eda933ed251))
* consolidate the chat composer, status bar, and approvals ([b67df31](https://github.com/wygoralves/panes/commit/b67df310e677faa427bbc542cb5a12b98faf8a6d))
* front the permission picker with autonomy presets ([acf2765](https://github.com/wygoralves/panes/commit/acf27653348ea6b494a161e43ff186c0882e798f))
* let toasts carry a title, wrapping body, and action ([a12697f](https://github.com/wygoralves/panes/commit/a12697fa87d2d9cf7e854d8bc79c016dfc59ebbe))
* make approval requests readable in the composer banner ([9f2f25a](https://github.com/wygoralves/panes/commit/9f2f25a2c44a75f8278f3cad4b6a91db71d45ea1))
* rework message blocks onto the shared block grammar ([8fb41bf](https://github.com/wygoralves/panes/commit/8fb41bf990525e25e64762a8ed33c751c4ec0206))
* surface background approvals and default autonomy ([a6a1c8b](https://github.com/wygoralves/panes/commit/a6a1c8b8c767f30289ccb93c31c554b29ea6c8d0))

### Bug Fixes

* install both darwin arches for the universal sidecar build ([20bf47e](https://github.com/wygoralves/panes/commit/20bf47e05a8b4f2fe8e9be58ada7e7e1874698d6))
* make the read-only preset copy match codex untrusted semantics ([08fe23e](https://github.com/wygoralves/panes/commit/08fe23e3927ebcd178498d1348e61fdb46a9b4c2))
* open chat diff files at the repo-relative path ([0c7a824](https://github.com/wygoralves/panes/commit/0c7a824bcc7572f9f81918f18bbbbb01704becec))
* repair autonomy presets under external sandbox mode and picker layout ([a294822](https://github.com/wygoralves/panes/commit/a2948223d2a86241ba03324cac12e7ae8a93b23b))
* resolve external sandbox mode from the backend for autonomy presets ([66cc741](https://github.com/wygoralves/panes/commit/66cc741f5fa8f0e35952c5f77e3d263a610ca632))

## [](https://github.com/wygoralves/panes/compare/v0.62.1...vnull) (2026-07-12)

### Bug Fixes

* stage native agent runtime packages ([a0f483f](https://github.com/wygoralves/panes/commit/a0f483ff88d5c77970b1841e23ff3ddf8f65dcac))

## [](https://github.com/wygoralves/panes/compare/v0.62.0...vnull) (2026-07-12)

### Bug Fixes

* require disposable child process support ([f3793c0](https://github.com/wygoralves/panes/commit/f3793c0d1ece591bdb1d24ed177e838501f60330))
* select compatible Node runtime for agent sidecar ([417715f](https://github.com/wygoralves/panes/commit/417715fb0e9d8de4eecca89ed2b10c38bf23016a))

## [](https://github.com/wygoralves/panes/compare/v0.61.0...vnull) (2026-07-12)

### Features

* add unified fullscreen settings ([b79d1f1](https://github.com/wygoralves/panes/commit/b79d1f18743af4714fc0a4aecbb79643005a9efa))
* add usage limits to chat and Manage ([b0c3a0c](https://github.com/wygoralves/panes/commit/b0c3a0c0a5d5e67004cd0201d940d1a4b4ee2447))
* discover runtime models and provider limits ([4c8ef3a](https://github.com/wygoralves/panes/commit/4c8ef3a883377b1fd126378b35cd5190415a4a85))
* track application update progress ([9fde64f](https://github.com/wygoralves/panes/commit/9fde64f0ff83e166c3288ef100e19ddeeb6dc333))

### Bug Fixes

* avoid terminal process lock contention ([5aada51](https://github.com/wygoralves/panes/commit/5aada5192533e175a020e1f9300e6ceebc7708d7))
* bound unterminated terminal OSC sequences ([0cafd52](https://github.com/wygoralves/panes/commit/0cafd52117ba1bb102dff4c185fbaae0c9465062))
* fit model controls in narrow panes ([4423053](https://github.com/wygoralves/panes/commit/4423053d638b2fb832170024131e6f3796a59bbe))
* harden Git checkout and discard flows ([f9978e7](https://github.com/wygoralves/panes/commit/f9978e7b78de6b3bce96f4f0fd2e98e9775daa85))
* index assistant replies in global search ([494f6c4](https://github.com/wygoralves/panes/commit/494f6c474c31803897a3061c98e5fdfe38888630))
* match terminal preview to app theme ([7079304](https://github.com/wygoralves/panes/commit/70793045cbfac6eaa07355ce2fd92381d2f93ce9))
* polish landing page motion and alignment ([f2a88cb](https://github.com/wygoralves/panes/commit/f2a88cb93b4b6decff0b721d5830d8affc78d191))
* preserve legacy Claude thread models ([58246f1](https://github.com/wygoralves/panes/commit/58246f13e3fc934d5a2c6602fad6fd92ae197923))
* require explicit Codex sandbox denials ([cbc79d5](https://github.com/wygoralves/panes/commit/cbc79d5002459ef38ae4b25b4f4f3b77e06a20b0))
* restore and present provider usage limits ([14df530](https://github.com/wygoralves/panes/commit/14df5302d1dcbbafc49ebcd764ed67774d914974))

### Performance Improvements

* make chat submissions responsive ([ab8c204](https://github.com/wygoralves/panes/commit/ab8c204093c21225ca9e18f9e5cc4f5c06b948cd))

## [](https://github.com/wygoralves/panes/compare/v0.60.0...vnull) (2026-07-11)

### Features

* add landing light theme and refresh product mockup ([71531a7](https://github.com/wygoralves/panes/commit/71531a789d8e93774de6acbc00ce3832c2387665))
* add Panes brand system and assets ([55df8af](https://github.com/wygoralves/panes/commit/55df8afcd25c3e4c566c1bc71032a46f8b1517b2))
* apply brand identity to desktop app ([f5c8828](https://github.com/wygoralves/panes/commit/f5c8828c1aafac8208a3feb199fccc3f3f819aea))
* publish redesigned Panes landing page ([efd9b4d](https://github.com/wygoralves/panes/commit/efd9b4deb9ff7ddf6b8ca8d78806d841ecbcd5a0))
* refine layered workspace surfaces ([4a1d043](https://github.com/wygoralves/panes/commit/4a1d04382b6ad4b8416b88f5218fe668b2d4ebdc))
* replace Panes application icons ([a3623a2](https://github.com/wygoralves/panes/commit/a3623a27823a78dbd97778a20fedeb65973e97d4))

### Bug Fixes

* clarify OpenCode chat support ([0f4bc73](https://github.com/wygoralves/panes/commit/0f4bc736e44d8541fc5a12875dc83d62e04d5f83))
* match Antigravity product icon color ([3180535](https://github.com/wygoralves/panes/commit/31805358c5258f7164a2853619fca41e0910ceb0))
* polish landing themes and bilingual copy ([f81b73e](https://github.com/wygoralves/panes/commit/f81b73ef6bcfc1e81ecb4809051effdc4e4135aa))
* refine theme contrast and shell spacing ([09e1143](https://github.com/wygoralves/panes/commit/09e11430b5c7001d738979d11c8d5a75205ff554))
* use official Antigravity CLI logo ([ea7a5d2](https://github.com/wygoralves/panes/commit/ea7a5d2599cb047eb33e8fa905f80c2c2e1bb0bf))

## [](https://github.com/wygoralves/panes/compare/v0.59.1...vnull) (2026-07-06)

### Features

* **editor:** add syntax highlighting for Java and C# files ([c96e7d2](https://github.com/wygoralves/panes/commit/c96e7d24754dc6552a1ee6b5bb2e2b1083c01359))
* **packaging:** add experimental flatpak manifest and mise install path ([8923aea](https://github.com/wygoralves/panes/commit/8923aeacdfaf38bf91ce739117bd60161bc41104))
* **terminal:** add configurable terminal font size ([5b15ac0](https://github.com/wygoralves/panes/commit/5b15ac09acacf3d10f28f9c8a98e8fa903fc3337))
* **ui:** add light mode theme ([fc5382a](https://github.com/wygoralves/panes/commit/fc5382a6a67df1847bbda245fcf88ae6003cf13f))
* **workspace:** add a discoverable file plus chat split view ([bac435e](https://github.com/wygoralves/panes/commit/bac435e8bb8902906ca874784e7c1b4f292b7a8d))

### Bug Fixes

* **harness:** add Antigravity CLI harness, mark Gemini CLI enterprise only ([5013ac4](https://github.com/wygoralves/panes/commit/5013ac426789361cbaf9d8ce74140358f659e4e7))
* **harness:** remove emdash from Antigravity logo comment ([d3e60b5](https://github.com/wygoralves/panes/commit/d3e60b573eff70abecb0edea792ccb1c17a181c8))
* **linux:** apply EGL/DMABUF webview workaround to X11 AppImage sessions ([6c7721e](https://github.com/wygoralves/panes/commit/6c7721e715b6313a3af807020cfd5e7107dff44a))
* **packaging:** address flatpak review findings ([0a71aaf](https://github.com/wygoralves/panes/commit/0a71aafbb6f8ceeb539560dd975dc58f5e4ad0a5))
* **terminal:** address review feedback on font size setting ([d37fb08](https://github.com/wygoralves/panes/commit/d37fb08512105b2167c12784f9e3658e9696f047))
* **ui:** fix light theme regressions, contrast, and remaining dark surfaces ([7a54862](https://github.com/wygoralves/panes/commit/7a54862197993317b59477f358a9d36d131ebd3f))
* **workspace:** reserve space for the split button over the tab bar ([bf6bb22](https://github.com/wygoralves/panes/commit/bf6bb22c48a72c126f6835f963e3e6e6d1eb7d60))
* **workspace:** tokenize the split button chip colors for light mode ([1ad561b](https://github.com/wygoralves/panes/commit/1ad561bce4bc98930d6242d26068acde440e9a16))

## [](https://github.com/wygoralves/panes/compare/v0.59.0...vnull) (2026-05-03)

### Bug Fixes

* **chat:** fix codex initialization bug on chat ([4adb7a2](https://github.com/wygoralves/panes/commit/4adb7a20cf84914851cb3d1dbfac846df08ff6f8))

## [](https://github.com/wygoralves/panes/compare/v0.58.0...vnull) (2026-05-02)

### Features

* **chat:** add pasted image previews ([c3addca](https://github.com/wygoralves/panes/commit/c3addcae348dde67d9db22021d6c315f906f3dbf))

### Bug Fixes

* **chat:** collapse duplicate diff blocks ([06312a4](https://github.com/wygoralves/panes/commit/06312a4f30711ac25c217b2447afaad33b38aca8))
* update codex schema parity check ([2726354](https://github.com/wygoralves/panes/commit/27263548ff1b5f857c261c300d959be883007113))

## [](https://github.com/wygoralves/panes/compare/v0.57.1...vnull) (2026-05-01)

### Features

* **chat:** expose Codex runtime permissions ([6ee1b4f](https://github.com/wygoralves/panes/commit/6ee1b4f15ac9d88db9de8213c305295c26b6fa4d))
* **codex:** align app-server chat protocol ([f4d317a](https://github.com/wygoralves/panes/commit/f4d317a7be32b4e037c4d5648779aa2f0c57e202))

### Bug Fixes

* **engines:** inherit login shell env ([15732f1](https://github.com/wygoralves/panes/commit/15732f10985ff4e6b7562772df77f1b80355d325))

## [](https://github.com/wygoralves/panes/compare/v0.57.0...vnull) (2026-04-28)

### Bug Fixes

* **editor:** open direct files without explorer ([099d234](https://github.com/wygoralves/panes/commit/099d2347a3e3ec01aafce7f5b1af472279204ed1))
* **files:** search workspace filenames from cache ([74a0142](https://github.com/wygoralves/panes/commit/74a014268f6cebc56e46c4a3a8be69c33957a95a))
* **git:** keep flyout open for internal clicks ([41756a5](https://github.com/wygoralves/panes/commit/41756a5a6b50547c465107fc40cf4ba33d715ba8))

## [](https://github.com/wygoralves/panes/compare/v0.56.2...vnull) (2026-04-27)

### Features

* **chat:** add inline file reference resolution ([1aa069a](https://github.com/wygoralves/panes/commit/1aa069acb629fbfd1e31b48c5bb9c4df8ae45556))
* **opencode:** add backend engine ([3f7708d](https://github.com/wygoralves/panes/commit/3f7708dcde90c80df4b94be7f4320addffce603e))
* **opencode:** add frontend chat support ([27cfc56](https://github.com/wygoralves/panes/commit/27cfc56edde45701ecb97dd004cf2730b652356e))
* **opencode:** add model attachment metadata ([2863e96](https://github.com/wygoralves/panes/commit/2863e96174ad0b7f3a9612e9cc0b0addd48021f6))
* **opencode:** add session lifecycle tools ([31b6e43](https://github.com/wygoralves/panes/commit/31b6e433225546d01f7e0fa5c673137408268160))
* **opencode:** expose reasoning variants ([fecc32d](https://github.com/wygoralves/panes/commit/fecc32d5c6a4428ffda7ecf69a6628ce1f316689))
* **opencode:** expose runtime controls ([5ecff3c](https://github.com/wygoralves/panes/commit/5ecff3c9784c7265d50e6d63250967c82e164740))
* **opencode:** improve model picker and approvals ([115c623](https://github.com/wygoralves/panes/commit/115c623a60b3798c0b1487364d13299d8f1c6b83))
* **opencode:** improve usage and question handling ([0e75bc1](https://github.com/wygoralves/panes/commit/0e75bc1da3409857d8ce30bb4cbd2c1acc05e4c9))

### Bug Fixes

* **chat:** reduce model picker visual noise ([2f5a59d](https://github.com/wygoralves/panes/commit/2f5a59d79256c1abb081605d36ce4522e0308f2d))
* **opencode:** composer reasoning fallback ([415f163](https://github.com/wygoralves/panes/commit/415f1632fc898ca1f15d217b3f7da2d7a5ecb25d))
* **opencode:** permission mode resumes ([2429698](https://github.com/wygoralves/panes/commit/24296981651d99afdda2ca7fb4b3f7ebaad935a1))
* **opencode:** stabilize turns and idle memory ([6550bc4](https://github.com/wygoralves/panes/commit/6550bc48b95ac6e4260c63ff1c91fb32b8afcc42))
* **perf:** bound completed terminal replay snapshots ([c1f2993](https://github.com/wygoralves/panes/commit/c1f29934cbc6a08ab241766812bd3f3be122d828))
* **perf:** coalesce consecutive stream events in chat queue ([7afbf27](https://github.com/wygoralves/panes/commit/7afbf2737c5b60e074ecbd772f0d8aae70bb1519))
* **perf:** store codex action details as raw json ([1e21554](https://github.com/wygoralves/panes/commit/1e21554b2ca3d220bdac17d214b5f7c708594144))
* **perf:** trim large codex payloads at protocol boundary ([2b4244d](https://github.com/wygoralves/panes/commit/2b4244d9714ec0595f3ed3763ccb0669721da7c6))

## [](https://github.com/wygoralves/panes/compare/v0.56.1...vnull) (2026-04-25)

### Bug Fixes

* **perf:** another targeted perf tweak ([c014c47](https://github.com/wygoralves/panes/commit/c014c476d834cc2c2d3c7ca961291b24f98f1bdd))

## [](https://github.com/wygoralves/panes/compare/v0.56.0...vnull) (2026-04-25)

### Bug Fixes

* **perf:** first batch of perf improvements for reduced RAM usage ([aa843b4](https://github.com/wygoralves/panes/commit/aa843b498c873289765a13e27cab5ff0728b48ff))

## [](https://github.com/wygoralves/panes/compare/v0.55.0...vnull) (2026-04-25)

### Features

* add workspace pane splitting ([41e4c02](https://github.com/wygoralves/panes/commit/41e4c02afd084f15805613ec9e0060fbb8b036ad))
* improve file link navigation ([29deac1](https://github.com/wygoralves/panes/commit/29deac1e87ac40fb07098b96ac74e214a8870def))

### Bug Fixes

* **terminal:** add output backpressure ([e2fcaf6](https://github.com/wygoralves/panes/commit/e2fcaf6b0280b5d58486c44ef4ba3363ddd2b7d9))
* **workspace:** preserve source pane for file links ([fb1a3de](https://github.com/wygoralves/panes/commit/fb1a3dec56de14ce1f25611d299c24ec7c05f195))

## [](https://github.com/wygoralves/panes/compare/v0.54.1...vnull) (2026-04-20)

### Features

* **chat:** add opus 4.7 to chat model picker and gate hyperlinks through shift+click ([ddde36b](https://github.com/wygoralves/panes/commit/ddde36b949723d8a3f9377cf1817939a77d920a8))

## [](https://github.com/wygoralves/panes/compare/v0.54.0...vnull) (2026-04-09)

### Bug Fixes

* **sidebar:** fix missing separator between actions and workspaces ([9a25f16](https://github.com/wygoralves/panes/commit/9a25f164548393b12f57b8a15fb4f981e2bf893e))
* **sidebar:** fix visuals of the rail sidebar ([589ccc6](https://github.com/wygoralves/panes/commit/589ccc6647035e187800445088afd9fe3b227b7b))

## [](https://github.com/wygoralves/panes/compare/v0.53.0...vnull) (2026-04-09)

### Features

* **sidebar:** add shortcut actions and hints ([ca73839](https://github.com/wygoralves/panes/commit/ca738390c08e6e7a743edc018932291c1dc0154d))
* **sidebar:** refresh workspace navigation ([e698847](https://github.com/wygoralves/panes/commit/e698847b3fd3b52de8c6d20d63d085083ccb57a3))

### Bug Fixes

* **chat:** preserve layout on new thread ([2aad6ec](https://github.com/wygoralves/panes/commit/2aad6ec946aa33e4427af88fabb8f4fde21859bc))
* **explorer:** cancel stale scheduled refreshes ([cdd5a6e](https://github.com/wygoralves/panes/commit/cdd5a6e6d14fba0e837fe6c67ece7cbfe19fa8da))
* **explorer:** refresh stale directory state ([4cda120](https://github.com/wygoralves/panes/commit/4cda120f469afa2bdd830392c7c8792b8d853d55))
* **git:** align panel pin icon ([8df1334](https://github.com/wygoralves/panes/commit/8df133432acbf9721a5be9ccf31e92ce96f5e056))
* **sidebar:** constrain expanded thread lists ([f9e9219](https://github.com/wygoralves/panes/commit/f9e9219cf2f0bb212fd647aa33cae061ab19e3d2))
* **sidebar:** open search palette from nav ([9f0abe4](https://github.com/wygoralves/panes/commit/9f0abe4aefbd65f4d1b156853752987a68d7bc58))
* **ui:** refine sidebar thread actions ([9ca2acc](https://github.com/wygoralves/panes/commit/9ca2acc84993261d122ab3d5871065237aa68e74))

## [](https://github.com/wygoralves/panes/compare/v0.52.0...vnull) (2026-04-09)

### Features

* **editor:** add collapsible file explorer ([4521fda](https://github.com/wygoralves/panes/commit/4521fdad8faf15dadd1efabce0519d73b379c3bf))
* **editor:** add contextual menu for actions and bulk actions in file explorer ([4358fc4](https://github.com/wygoralves/panes/commit/4358fc47a6615e5a6796a6311a4d9e98c9beb4f0))
* **editor:** adjust plus button positioning on the file explorer ([e36601c](https://github.com/wygoralves/panes/commit/e36601c914bcffb10ee9d2fcd731471d5e37e56e))
* **editor:** open files in the default app ([b37cd82](https://github.com/wygoralves/panes/commit/b37cd823876e73f2da166f13f534ab9f2943c7ba))

### Bug Fixes

* **editor:** hide empty button container ([df4787a](https://github.com/wygoralves/panes/commit/df4787af985b0dec25c451e2bdcd8503c76bdff0))
* **editor:** show external open action for all files ([9940e1e](https://github.com/wygoralves/panes/commit/9940e1e46764ab85bd033d141489da3074413c0e))
* **editor:** stabilize explorer routing and state ([696bd42](https://github.com/wygoralves/panes/commit/696bd4226f4e1e87fc006a2ddd10f5d07f664c45))
* **explorer:** address final review findings ([9d38ddb](https://github.com/wygoralves/panes/commit/9d38ddb8b5ad04c021ba8f9fbea477731f99ea0b))
* **filesystem:** reject unresolved create paths ([f079d2e](https://github.com/wygoralves/panes/commit/f079d2e5b97a5ba8479aeb987261832dcd81c779))

## [](https://github.com/wygoralves/panes/compare/v0.51.4...vnull) (2026-04-08)

### Features

* **commandpalette:** improve multi repo handling in git operations ([272a24b](https://github.com/wygoralves/panes/commit/272a24b3405d5acb3ffd0c58c436983c7d499efb))
* **git:** add Fetch All and Pull All for multi-repo mode ([36223a2](https://github.com/wygoralves/panes/commit/36223a2d97bd3eb11cb1dde595782bb2e83ed8d8))
* **git:** add MultiRepoChangesView with accordion pattern ([612e17e](https://github.com/wygoralves/panes/commit/612e17ec01dc30b053cd08c0305797103a796f21))
* **git:** add per-repo more menu with pull, push, undo last commit ([d420a0d](https://github.com/wygoralves/panes/commit/d420a0dec458358fed04dfa7d86b98842ffdbfd9))

### Bug Fixes

* **git:** address Codex review — stale status, directory discard, per-repo commit ([b7dd34b](https://github.com/wygoralves/panes/commit/b7dd34b7ea3e583aae7f0b2888e261d6f229c298))
* **git:** align more menu in multi-repo mode and spin RefreshCw during fetch all ([6a19871](https://github.com/wygoralves/panes/commit/6a1987150216569ec40d94c50c9983c509adab3e))
* **git:** hide branch meta and repo picker in multi-repo changes mode ([9356bd7](https://github.com/wygoralves/panes/commit/9356bd7a97919b0d960a8f7962957f7ce671e203))
* **git:** keep multi-repo changes view in sync ([54e6539](https://github.com/wygoralves/panes/commit/54e65391fd4f366a1218170813e3ebb033cf9bad))
* **gitpanel:** restrict repo-scoped git picker to active repos only ([d189e9d](https://github.com/wygoralves/panes/commit/d189e9d105a3d5d9fd7c23e6390635b76ebcd57a))

## [](https://github.com/wygoralves/panes/compare/v0.51.3...vnull) (2026-04-05)

### Bug Fixes

* **gitpanel:** fix git panel collapsing incorrectly in some scenarios ([03d6ec1](https://github.com/wygoralves/panes/commit/03d6ec16330d135627e0bfc410f29dd5b495e352))

## [](https://github.com/wygoralves/panes/compare/v0.51.2...vnull) (2026-04-01)

### Bug Fixes

* **ci:** harden release bundles across platforms ([65f050a](https://github.com/wygoralves/panes/commit/65f050a0f893b0dca3d899f0355279b8e322e344))

## [](https://github.com/wygoralves/panes/compare/v0.51.1...vnull) (2026-04-01)

### Bug Fixes

* **notifications:** fix stale ui state on notifications ([4fe75dc](https://github.com/wygoralves/panes/commit/4fe75dc71291a49dec2efd6301af0780ab919f45))

## [](https://github.com/wygoralves/panes/compare/v0.51.0...vnull) (2026-04-01)

### Bug Fixes

* **ubuntu:** fix regression caused by changes on claude sidecar bundling ([c125f0a](https://github.com/wygoralves/panes/commit/c125f0ab935d6105b1e50d2d5e055f25493b0e27))

## [](https://github.com/wygoralves/panes/compare/v0.50.0...vnull) (2026-03-31)

### Features

* **fileeditor:** add markdown preview to file editor ([33cd052](https://github.com/wygoralves/panes/commit/33cd0526e25407592a09c5635500c9b950afd7c1))

## [](https://github.com/wygoralves/panes/compare/v0.49.1...vnull) (2026-03-30)

### Features

* **chat:** improve fast mode and model pickers ([43a4a37](https://github.com/wygoralves/panes/commit/43a4a37b919c6c4bf20abe1d92794414f5a676ae))

### Bug Fixes

* **claude:** fix bundling on prod build to restore claude sdk functionality ([f82540a](https://github.com/wygoralves/panes/commit/f82540ad5a307550a59141659d793dfddba9001c))

## [](https://github.com/wygoralves/panes/compare/v0.49.0...vnull) (2026-03-29)

### Bug Fixes

* **codex:** align Codex context meter semantics ([64046f9](https://github.com/wygoralves/panes/commit/64046f9537493fc96ef0b44b20785fbe2b26513c))
* **codex:** fix plan handoff and context calc on codex ([312ba42](https://github.com/wygoralves/panes/commit/312ba4295966c7e36dfe2dac88c77928e0b6ab86))
* **gitpanel:** properly show fullscreen dialog when discarding git changes ([9908169](https://github.com/wygoralves/panes/commit/99081698878617297ef72d101e15b221c1739910))
* **sidebar:** properly show compressed groups on startup ([1d4f094](https://github.com/wygoralves/panes/commit/1d4f094b1847c5057429fc29a7274a704bd8aad0))

## [](https://github.com/wygoralves/panes/compare/v0.48.0...vnull) (2026-03-27)

### Features

* **nav:** improve file management and opening in the file editor ([b900ed2](https://github.com/wygoralves/panes/commit/b900ed26c78e50b8b5489d753f4ff4f053e20fc9))

## [](https://github.com/wygoralves/panes/compare/v0.47.0...vnull) (2026-03-27)

### Features

* **nav:** add smart compress expand for git and nav panels ([503bc7d](https://github.com/wygoralves/panes/commit/503bc7d9b7b57f564967eca13875a226b92285f9))

## [](https://github.com/wygoralves/panes/compare/v0.46.4...vnull) (2026-03-27)

### Features

* **chat:** add cycle between last messages with option + arrow ([a95951f](https://github.com/wygoralves/panes/commit/a95951f1da34d6cc2763bdad6725b5ea99535ef6))
* **chat:** add file link opening to file editor ([98c6618](https://github.com/wygoralves/panes/commit/98c6618d82a1640569fa3763d037db5ac131d5f3))
* **chat:** add markdown rendering when streaming and fix some broken md renders ([3a2ac55](https://github.com/wygoralves/panes/commit/3a2ac55c2ef2ca5de51779a15bc238bdcb9626a9))
* **chat:** add question details for answer blocks ([59b86a2](https://github.com/wygoralves/panes/commit/59b86a2d05861b8f52e72fe1c57f5774680710d3))
* **chat:** add switch to toggle diff view on file editor ([1e496ae](https://github.com/wygoralves/panes/commit/1e496ae27a8cc0e9b645c1d0f7296309dbe058a2))
* **chat:** adjust notification dot color ([91e7d4c](https://github.com/wygoralves/panes/commit/91e7d4cbe6a895cb61abba2a124f83b0799e7f8d))
* **chat:** improve answered questions UI ([8b26ac7](https://github.com/wygoralves/panes/commit/8b26ac73ad89435379c3bc38bc064578d737fc28))
* **chat:** improve default model heritage between threads ([9444a8e](https://github.com/wygoralves/panes/commit/9444a8e1a6b0d5b64f1160832dffcb9c149077e9))
* **chat:** improve markdown rendering ([6bf3345](https://github.com/wygoralves/panes/commit/6bf334542afafde8e83feb66126de722999e0968))
* **chat:** improve styling on text and icons ([bd08469](https://github.com/wygoralves/panes/commit/bd084695dfd9102505471145bd572b657c4a8b61))
* **chat:** improve thinking blocks handling ([91ec192](https://github.com/wygoralves/panes/commit/91ec192941cc1fbe213f0e0da1b96e47f06e8e3a))
* **chat:** improve UI for steering and add copy messages ([5d6446f](https://github.com/wygoralves/panes/commit/5d6446f5caf5d2efbadda5c1e95899b8f3bdb168))
* **chat:** improve UI on the chatarea ([56786b1](https://github.com/wygoralves/panes/commit/56786b19259cf9773b4700fd015f4597c98f1750))
* **chat:** improve usability for claude code planning mode ([f4ae9c7](https://github.com/wygoralves/panes/commit/f4ae9c7f957ec4ad8192dff1916966a191ed9132))
* **chat:** improve visibility of commands ([5c807b0](https://github.com/wygoralves/panes/commit/5c807b04f8262d4dc08c5a6c9950250623da3235))
* **chat:** make code blocks readability better ([a346578](https://github.com/wygoralves/panes/commit/a346578d1570698173dada427b695464286b5b80))
* **chat:** make expandable blocks appear compressed by default ([74620a0](https://github.com/wygoralves/panes/commit/74620a087eef6df07a8f5db43971453ef6b5204c))
* **chat:** reduce clutter on chat UI and add thinking duration ([fef6e6e](https://github.com/wygoralves/panes/commit/fef6e6e6c42909c27bb736e68c9e0e9cc05ad844))
* **chat:** remove orphaned empty messages when stopping turns and improve ui for tool call results ([2299fa8](https://github.com/wygoralves/panes/commit/2299fa80206114af38d950206fe556ecf81b019a))
* **chat:** smoothen md renderer worker visibility ([19041c5](https://github.com/wygoralves/panes/commit/19041c5aec1fac99a9c59e3ced1fb97c1eb3e12e))
* **chat:** smoothen UI components on the chat area to make it more scannable ([c3f6f51](https://github.com/wygoralves/panes/commit/c3f6f5153d64034f73e421ef59a48fee67d96c89))

### Bug Fixes

* **chat:** better handle malformed percent encoding in file links ([591c74e](https://github.com/wygoralves/panes/commit/591c74e5aa13e2facc30ec3ae174dd5a1ec3db71))
* **chat:** fix exitplanmode command for claude code ([35236a0](https://github.com/wygoralves/panes/commit/35236a048d14d482fcf399765662d0615ff9f04b))
* **chat:** fix frontend losing track of active chats when switching between threads ([9812f33](https://github.com/wygoralves/panes/commit/9812f33510ed09dfcb4f8484306b60dfac3fc638))

## [](https://github.com/wygoralves/panes/compare/v0.46.3...vnull) (2026-03-26)

### Bug Fixes

* **startup:** harden lazy startup without stale engine state ([22db45c](https://github.com/wygoralves/panes/commit/22db45c0f5ceeb6a24e992247e1a15c549bd6bca))

## [](https://github.com/wygoralves/panes/compare/v0.46.2...vnull) (2026-03-25)

### Bug Fixes

* **chat:** address more edge cases on planning handoff ([4680279](https://github.com/wygoralves/panes/commit/4680279cf114068a3e485c3c109838d39de2f463))
* **chat:** fix frontend race on codex plan execution ([1f3508d](https://github.com/wygoralves/panes/commit/1f3508d4bf326fff56b5d10b408271549a18a79d))
* **chat:** some more adjustments to the plan handoff to execution mode ([2b52f52](https://github.com/wygoralves/panes/commit/2b52f52a8586e417d9f2712333bdc69395e43344))

## [](https://github.com/wygoralves/panes/compare/v0.46.1...vnull) (2026-03-25)

### Bug Fixes

* **chat:** adjust and fix plan-mode handoff flow ([2e3ca87](https://github.com/wygoralves/panes/commit/2e3ca8764a0d60a17eb0b8f08a174d92f9158941))

## [](https://github.com/wygoralves/panes/compare/v0.46.0...vnull) (2026-03-24)

### Bug Fixes

* **notifications:** play macOS preview sounds directly ([11360bd](https://github.com/wygoralves/panes/commit/11360bded91687c4e95524546319906a3efcc21a))

## [](https://github.com/wygoralves/panes/compare/v0.45.2...vnull) (2026-03-24)

### Features

* **notifications:** add chat notifications ([a4ca990](https://github.com/wygoralves/panes/commit/a4ca9900355868bc1d268647bc9a9ac3f2b3a781))
* **notifications:** add interface and configs for notifications on terminal ([c5fcedd](https://github.com/wygoralves/panes/commit/c5fcedd620c2c1ae0b691ed9c1c185df9ab0acb0))
* **notifications:** add sound settings for notifications ([2f65897](https://github.com/wygoralves/panes/commit/2f6589723af421dc52ac6d62efc2d1eec2e08d01))
* **notifications:** improve ui for notifications ([0f15fa4](https://github.com/wygoralves/panes/commit/0f15fa47fb540e7b72852b47eba5cb2b05a511e5))
* **terminal:** add Claude notification hooks ([64dae9c](https://github.com/wygoralves/panes/commit/64dae9c38d72187f4230fc7f14c77ec150bdf9c0))
* **terminal:** add Codex notification bridge ([8bab1b3](https://github.com/wygoralves/panes/commit/8bab1b3c3593c548df6c6bcbce54592ab24d1a69))
* **terminal:** add notification ingress foundation ([42d9126](https://github.com/wygoralves/panes/commit/42d9126aa28d21b33295a6097ece84c3554bedea))
* **terminal:** add OSC notification fallback ([0da172b](https://github.com/wygoralves/panes/commit/0da172b383fcf2fd303f74545a621a92aaa8fc8a))
* **terminal:** wire notification state into terminal UI ([b43065b](https://github.com/wygoralves/panes/commit/b43065ba044bd0084dcf9d237bffd641ff2b6f32))

### Bug Fixes

* address code review findings on notifications ([c4d06b8](https://github.com/wygoralves/panes/commit/c4d06b84bd81443c0d517467375596fa4e807bb7))
* **notifications:** decouple agent notifications from terminal startup ([b94715f](https://github.com/wygoralves/panes/commit/b94715f316272496c99b53c80b9b5fd61e1ce5aa))
* **terminal:** preserve notification hydration ordering ([ea14f40](https://github.com/wygoralves/panes/commit/ea14f40d01a799cb9bc2560e280453a40c132c01))

## [](https://github.com/wygoralves/panes/compare/v0.45.1...vnull) (2026-03-22)

### Bug Fixes

* **codex:** harden Codex reconnect recovery ([36476fd](https://github.com/wygoralves/panes/commit/36476fd18752898b4009512313b62a22db106875))

## [](https://github.com/wygoralves/panes/compare/v0.45.0...vnull) (2026-03-16)

### Bug Fixes

* **codex:** harden Codex turn completion handling ([f1df9fa](https://github.com/wygoralves/panes/commit/f1df9fafbbd7ded7d040c9b8425972f365084fa1))

## [](https://github.com/wygoralves/panes/compare/v0.44.0...vnull) (2026-03-15)

### Features

* **windows:** unify custom window chrome on Windows ([b51da26](https://github.com/wygoralves/panes/commit/b51da268ccedcc108d16e51d4dda5adfcb9eee4f))

## [](https://github.com/wygoralves/panes/compare/v0.43.0...vnull) (2026-03-15)

### Features

* **linux:** add Debian updater target and Linux CI smoke test ([90db0ae](https://github.com/wygoralves/panes/commit/90db0ae274fcfeb6e291f4d011e24051f8457bd3))

## [](https://github.com/wygoralves/panes/compare/v0.42.0...vnull) (2026-03-15)

### Features

* **power:** add clamshell lid-close sleep prevention via privileged helper ([cddbe8a](https://github.com/wygoralves/panes/commit/cddbe8afe2ad6be31d62df7016e29debb45cec9f))
* **power:** adjust time picker for session duration ([63203f3](https://github.com/wygoralves/panes/commit/63203f3c91841f579d31a05addcc074bff1a2874))
* **power:** harden macOS keep-awake backend ([e1cac2e](https://github.com/wygoralves/panes/commit/e1cac2e940c5818fd06ffeec580cbb32405fecf1))
* **power:** implement advanced power management settings ([269ba74](https://github.com/wygoralves/panes/commit/269ba74198a7e0ec7a7ef12693878b1913880e5e))
* **power:** replace caffeinate with direct IOKit assertions on macOS ([e53216c](https://github.com/wygoralves/panes/commit/e53216c0d54f46cd9828359d50bdbd23d2aa66fb))

### Bug Fixes

* **linux:** address ui freeze on appimage build ([763bd2e](https://github.com/wygoralves/panes/commit/763bd2ee4d9787db924440117e389ebb9a903bcf))
* **power:** add pmset fallback for lid-close prevention in dev builds ([0b33195](https://github.com/wygoralves/panes/commit/0b331958c6adebdeeb50de917663674078dbe720))
* **power:** address code review findings ([8bb308b](https://github.com/wygoralves/panes/commit/8bb308b7299c8003b03a5908edb68bfc5add0327))
* **power:** address review findings for power management ([422e547](https://github.com/wygoralves/panes/commit/422e5470626bfa70fdcdb7b7f39d767415f05093))
* **power:** harden keep-awake power settings flow ([8cf85e6](https://github.com/wygoralves/panes/commit/8cf85e61cb00e8e95475e33d93767dac8a7092f6))
* **power:** include -s flag in default macOS caffeinate args ([a4ddf13](https://github.com/wygoralves/panes/commit/a4ddf13360020a9e6ff6ea93cf7afd50d8f9dcee))
* **powermgmt:** align power status with runtime transitions ([cf9d8b1](https://github.com/wygoralves/panes/commit/cf9d8b18ac87ccd1ab8c9a2263144bcb82487f9c))
* **powermgmt:** harden power management state transitions ([db4d941](https://github.com/wygoralves/panes/commit/db4d941c96dddd2a776f2255467d3a80f68f58d9))
* **power:** preserve platform-specific power settings semantics ([d1c910d](https://github.com/wygoralves/panes/commit/d1c910dfff43e5b8deec1b6ae28a5fb68ca59337))
* **power:** receive monitor events without holding the runtime mutex ([0b244fd](https://github.com/wygoralves/panes/commit/0b244fd0136ad61e7cfa08c77edca670d632d0a7))
* **power:** reorder power mgmt menu sections ([11977af](https://github.com/wygoralves/panes/commit/11977afceb8a2890c14d1395be7990230b788d4b))
* **power:** wire PowerProfile through spawner and add Linux display inhibit ([a12c83c](https://github.com/wygoralves/panes/commit/a12c83cb55ef5473cbc8e4c9cb34847592486f4e))

## [](https://github.com/wygoralves/panes/compare/v0.41.0...vnull) (2026-03-15)

### Features

* **claude:** expand more feature coverage and parity on plan mode and tool use ([1cd5731](https://github.com/wygoralves/panes/commit/1cd57313dadd0f3f0559cfdd3668c1a87e9a2e8e))
* **gitpanel:** improve logic of dropdown opening of the gitpanel ([55312cc](https://github.com/wygoralves/panes/commit/55312ccee9edb488ee6b682adbcf21fb40a4a01a))

### Bug Fixes

* **claude:** emit stop-reason notice before turn completion ([0bd3ff5](https://github.com/wygoralves/panes/commit/0bd3ff5bfb81c1eb65eaaa6f9333ebb65719f852))
* close Claude parity gaps ([598ce4a](https://github.com/wygoralves/panes/commit/598ce4a01be88c891a20358558c548d491c955f5))
* **compatibility:** harden cross-platform tool and power detection ([b15996f](https://github.com/wygoralves/panes/commit/b15996fc008b03607c9dd15242692b400a7c4ae6))
* **compatibility:** normalize persisted Windows workspace roots ([f8195f2](https://github.com/wygoralves/panes/commit/f8195f24c9c35ef3fb32a793c4a98f7392fdfa0f))
* **harnesses:** fix install command for opencode ([fc7624a](https://github.com/wygoralves/panes/commit/fc7624a0cdc8ca19361d9a613e77187a2d8914e7))
* **harnesses:** harden PATH fallback config parsing ([5d84d5e](https://github.com/wygoralves/panes/commit/5d84d5eeb009762c9788771887cb33553c0f7ee5))

## [](https://github.com/wygoralves/panes/compare/v0.40.0...vnull) (2026-03-13)

### Features

* **codex:** add mid-turn steering ([8774268](https://github.com/wygoralves/panes/commit/87742681adc78c4d84a965223ffb995475631ff4))
* **codex:** add native review turns ([eea919d](https://github.com/wygoralves/panes/commit/eea919d7dcd50cfa8f145c924bc5b04e5d24d3a5))
* **codex:** add native thread branching tools ([fc4f3ad](https://github.com/wygoralves/panes/commit/fc4f3ad8e06c2ed3d26582db6c072345328b95cb))
* **codex:** add turn configuration parity ([1b9e272](https://github.com/wygoralves/panes/commit/1b9e272474418bea50d25fa8613feaae449896ef))
* **codex:** address more review findings across backend, stores, and components ([37d878a](https://github.com/wygoralves/panes/commit/37d878a1da1a3f6fa3b1374a99933d9b771ed0d6))
* **codex:** address more review findings across backend, stores, and components ([d04683e](https://github.com/wygoralves/panes/commit/d04683ef24813abd5bea6eb4ce9a26765949f8bc))
* **codex:** address review findings across backend, stores, and components ([58482f2](https://github.com/wygoralves/panes/commit/58482f296e85d13e0a66f52c213a4d99135e0684))
* **codex:** align plan questionnaire to not have ui leakages ([ffa3106](https://github.com/wygoralves/panes/commit/ffa3106849cb58f234c224fc5dee10e4953df48f))
* **codex:** close notification parity gaps ([589795e](https://github.com/wygoralves/panes/commit/589795e10e0b1a6fad4f546cbbdc47f59ece9e80))
* **codex:** close runtime notification parity gaps ([de379ba](https://github.com/wygoralves/panes/commit/de379bad20e7ba73af001f5cb0e26d0d31c59978))
* **codex:** expand approval request parity ([d317435](https://github.com/wygoralves/panes/commit/d317435e49033da8b302d244190ed07cab191ffc))
* **codex:** finishing touches on UI for tool input questionnaire ([23f745b](https://github.com/wygoralves/panes/commit/23f745b3c832ab69a9e4d58a69eb8b8a21f64058))
* **codex:** improve compatibility with plan mode ([23affdd](https://github.com/wygoralves/panes/commit/23affddb13ef5e1a037610ab61eb19bd6c1af272))
* **codex:** improve fast UX and fix fmt issues ([ee62694](https://github.com/wygoralves/panes/commit/ee6269438971abb35a1368c7bd4e052704e212a6))
* **codex:** improve UI for slash commands ([2374c6e](https://github.com/wygoralves/panes/commit/2374c6e97c93b347545a9b1558469c6bef7d8e3e))
* **codex:** inline steer messages in active assistant bubble ([ba17a7f](https://github.com/wygoralves/panes/commit/ba17a7fd0dcc9907db2f634e040978df3920db81))
* **codex:** keep Codex thread state and approval controls consistent ([a88fc01](https://github.com/wygoralves/panes/commit/a88fc016167307915dd6002f465d767341269469))
* **codex:** make plan mode prompt-guided ([6c0de0f](https://github.com/wygoralves/panes/commit/6c0de0f0efdabbcdd5527a674251d07f8cc6c109))
* **codex:** polish components in slash commands ([abac5b1](https://github.com/wygoralves/panes/commit/abac5b1b8c4ca00a73b95bffe73bb6525e9ef1bf))
* **codex:** polish UI for tool input questionnaire ([45de9ca](https://github.com/wygoralves/panes/commit/45de9ca7a8be7f3d64d596d427b85ce5bae8b3f7))
* **codex:** preserve runtime model metadata ([14a69b5](https://github.com/wygoralves/panes/commit/14a69b51c61dd64cda7c085543b7accff2b640d2))
* **codex:** resume remote app-server threads ([63c3863](https://github.com/wygoralves/panes/commit/63c38635f406e58d8ab009f35ac26105627b67f7))
* **codex:** reuse codex threads across model changes ([d06b964](https://github.com/wygoralves/panes/commit/d06b964839862950c42743fba6b358e3d791c0bf))
* **codex:** support skills and app mentions ([6766105](https://github.com/wygoralves/panes/commit/6766105063dea0907daee0c23b6bf8b0d1ec4709))
* **codex:** surface runtime diagnostics ([51df6ee](https://github.com/wygoralves/panes/commit/51df6ee6cce6444095aa768e0fba57a1a96e1724))

### Bug Fixes

* **codex:** align live notification method shapes ([7841bf7](https://github.com/wygoralves/panes/commit/7841bf75d4ed3756d86485d1376837d1f7a513f3))
* **codex:** surface unsupported external auth mode ([3501bb2](https://github.com/wygoralves/panes/commit/3501bb23062791f23ab43c336c7d266d8cbcbe18))

## [](https://github.com/wygoralves/panes/compare/v0.39.0...vnull) (2026-03-13)

### Features

* **onboarding:** add finishing touches to panes onboarding ux ([5b06ae0](https://github.com/wygoralves/panes/commit/5b06ae05ee13bcda20250939843d0bc4fd977944))
* **onboarding:** add onboarding state foundation ([c1da1f7](https://github.com/wygoralves/panes/commit/c1da1f7d17913366799069f44a324566afc6d37b))
* **onboarding:** improve visuals of the onboarding flow ([9b4a018](https://github.com/wygoralves/panes/commit/9b4a018b2817edd57237a05bc16efd6f792c7e66))
* **onboarding:** more  finishing touches to panes onboarding ux ([a621877](https://github.com/wygoralves/panes/commit/a62187785847cd0f91af94ef51d52d65e8a027b4))
* **onboarding:** more ui improvements to the onboarding flow ([434ae50](https://github.com/wygoralves/panes/commit/434ae506eeabfb208597fdaa923a16e7f1fcabd1))
* **onboarding:** more ui improvements to the onboarding flow ([e768cbf](https://github.com/wygoralves/panes/commit/e768cbf80d715e253acfb0c97e09599ebad31aed))
* **onboarding:** more ui polish and i18n fixes  to the onboarding flow ([ee39e19](https://github.com/wygoralves/panes/commit/ee39e19bc9fdbea36abf5d31c34c9659d7e94bdc))
* **onboarding:** unify first-run onboarding flow ([d3e6a04](https://github.com/wygoralves/panes/commit/d3e6a042c45d772af70c6c22e7f4fb63d68b8dea))

### Bug Fixes

* **onboarding:** fix behavior regressions on onboarding flow ([3261e69](https://github.com/wygoralves/panes/commit/3261e691d09c0d3a1b5f2285d3059dfbfd7e5f83))
* **onboarding:** fix persistance of chat harness selection and some windows bugfixes ([672e10b](https://github.com/wygoralves/panes/commit/672e10be5b0f1476efaf553a0680b699e9238d02))
* **onboarding:** harden install and reopen recovery ([432b742](https://github.com/wygoralves/panes/commit/432b7425d565e74c1f10a71366cc1381d8148f0b))
* **onboarding:** serialize installs and readiness gating ([347e02f](https://github.com/wygoralves/panes/commit/347e02fc5fe9b02f07c1e058617955c057f91491))

## [](https://github.com/wygoralves/panes/compare/v0.38.0...vnull) (2026-03-12)

### Features

* **windows:** add keep awake backend support ([3594b11](https://github.com/wygoralves/panes/commit/3594b110824a14466ff68ec783fbe513b581f563))
* **windows:** add release pipeline and updater assets ([5094e54](https://github.com/wygoralves/panes/commit/5094e5477e10667e042e1af8d1e02f7f8f7293e2))
* **windows:** detect terminal foreground harnesses ([e3db0f2](https://github.com/wygoralves/panes/commit/e3db0f2f78764b0fa13a897d97dba72873571c2a))
* **windows:** fix fmt issue ([281d703](https://github.com/wygoralves/panes/commit/281d70324ab179ef164106477b8c5ce2d5bfce36))
* **windows:** fix more ci issues ([862ac15](https://github.com/wygoralves/panes/commit/862ac15c05f1a24f18c8303518b793b0dd661792))
* **windows:** fix ts errors ([45e3918](https://github.com/wygoralves/panes/commit/45e3918950406fab31057a53894896804e5debb9))
* **windows:** gate unsupported keep awake controls ([0b89ceb](https://github.com/wygoralves/panes/commit/0b89ceb8b55a38082057d65f863b54c70e99fb3b))
* **windows:** harden reveal path selection ([83998d4](https://github.com/wygoralves/panes/commit/83998d41c6113d1276abe1ba80ea36e26e5a6486))
* **windows:** harden terminal env and harness onboarding ([435d8ca](https://github.com/wygoralves/panes/commit/435d8caafbcab386226373ee8746fcb738258b8c))
* **windows:** improve engine health guidance ([f687705](https://github.com/wygoralves/panes/commit/f6877055499217131c4223b962130621095195d4))
* **windows:** normalize app data and setup discovery ([628dd8e](https://github.com/wygoralves/panes/commit/628dd8ea33c639d352caf30a59ee6562deaabe20))
* **windows:** update docs to warn rough edges on windows first release ([0f189b8](https://github.com/wygoralves/panes/commit/0f189b8337cc627c196b926e237ec33ffa21fc96))

### Bug Fixes

* **windows:** avoid install dir as default workspace ([76bba92](https://github.com/wygoralves/panes/commit/76bba9271ee28ddf5929ea4b0ec494ebfe13f6fa))
* **windows:** harden update manifest generation ([da0c982](https://github.com/wygoralves/panes/commit/da0c982699f7ac858d47f9d08fd705906c6f4827))
* **windows:** improve manual setup guidance ([5db2197](https://github.com/wygoralves/panes/commit/5db219784f63de6e3dea3d33a33961a2a8c833dd))
* **windows:** migrate app data and harden defaults ([a9c8200](https://github.com/wygoralves/panes/commit/a9c82007af4906fdb277a193abd4d505eb0574d6))
* **windows:** remove macos-only app menu items ([1120b04](https://github.com/wygoralves/panes/commit/1120b046db3a4460a4a1c7dee574756f08660684))
* **windows:** tweak ci scripts for windows build ([961c141](https://github.com/wygoralves/panes/commit/961c141728e197d8896dfdf0c549d3cf6af16960))

## [](https://github.com/wygoralves/panes/compare/v0.37.0...vnull) (2026-03-11)

### Features

* optimize terminal buffer, chat rendering, and editor cache ([b522c59](https://github.com/wygoralves/panes/commit/b522c5914b4e530384efb9fe19db587752c56b99))

### Bug Fixes

* fix clickable area of buttons ([0db8016](https://github.com/wygoralves/panes/commit/0db8016bd88a10da669220610de7d8fec4ab0b67))
* harden keep-awake helper lifecycle ([c6d89b6](https://github.com/wygoralves/panes/commit/c6d89b66274c649041c75283e54584fa510e1f6a))

## [](https://github.com/wygoralves/panes/compare/v0.36.0...vnull) (2026-03-10)

### Features

* add context menu in linux for terminal copy and paste actions ([459b08c](https://github.com/wygoralves/panes/commit/459b08c9740d689fc4156d914d38e61e685398b4))
* add custom linux chrome ([607b020](https://github.com/wygoralves/panes/commit/607b0203cbb767e53c08163c65aaf7aab503c72e))
* add linux AppImage desktop integration ([d745123](https://github.com/wygoralves/panes/commit/d745123a7015588c34498933fadd4c6b4d03946c))
* update visuals for bar ([eba175e](https://github.com/wygoralves/panes/commit/eba175ecee2a9b5a6626c91538334712fe5b7a9a))
* update visuals for custom linux bar ([75b5093](https://github.com/wygoralves/panes/commit/75b5093161df9bea8e84c1012e03a0627a386d3d))

### Bug Fixes

* enable clipboard access on main webview ([7c7555c](https://github.com/wygoralves/panes/commit/7c7555c9b1bb1f6d9aa368fc313540bd57b8fb1e))
* fix backend issue for window controls ([4ac5769](https://github.com/wygoralves/panes/commit/4ac576988fa593139b10f2f9a1155e1315f39137))
* fix possible regressions on other places native commands on linux ([4bbdece](https://github.com/wygoralves/panes/commit/4bbdecee22ae8ee67e64ab5ab03b577780675eee))
* fix window controls on linux custom bar ([872fff5](https://github.com/wygoralves/panes/commit/872fff5411ac15d7206941564d0cfa0a278a52c9))
* remove unnecessary  window controls from gitpanel ([4fee23f](https://github.com/wygoralves/panes/commit/4fee23f5c2ea64e6a4b9d1558d9e8a36cdfb6405))
* wire terminal clipboard shortcuts ([03b4f39](https://github.com/wygoralves/panes/commit/03b4f39016ccf6cb1ce18ffe3d5e21ad9e2305cf))

## [](https://github.com/wygoralves/panes/compare/v0.35.0...vnull) (2026-03-09)

### Features

* batch terminal input and add renderer toggles ([781998d](https://github.com/wygoralves/panes/commit/781998dd0a67d39b9cd6a880b357f38c1656a229))
* improve organization of the settings dropdown ([3b2ae67](https://github.com/wygoralves/panes/commit/3b2ae674551e4e741e56b2764af84585a3727c18))

### Bug Fixes

* fix config write races and Linux window decoration persistence ([178eca3](https://github.com/wygoralves/panes/commit/178eca32f97c1c494378fdce35f2636ad09e55ad))
* fix limits strings not being replaced ([297f24e](https://github.com/wygoralves/panes/commit/297f24e104be82f7c165f0f336574f55905de09c))
* fix renderer hydration regression ([fc5a736](https://github.com/wygoralves/panes/commit/fc5a73650b603920f53324f327a30be6aef646e5))
* reset stale Codex transport after auth failures ([ba76251](https://github.com/wygoralves/panes/commit/ba762510ceeb9c1bb6e24a64584217f922e8fe1e))

## [](https://github.com/wygoralves/panes/compare/v0.34.2...vnull) (2026-03-09)

### Features

* add keep awake feature to linux and macos builds ([52d39b8](https://github.com/wygoralves/panes/commit/52d39b8f617c61eea7402ce36df3954fdaf388ef))
* adjust settings dropdown styling ([830e5dc](https://github.com/wygoralves/panes/commit/830e5dc490df9f9e0cce1849b59047985f89e097))

### Bug Fixes

* avoid selfdeadlocking on app config ([87981de](https://github.com/wygoralves/panes/commit/87981de48a412a8f29876c095d6553191f55ffe3))
* fix macos release smoke false negative ([38ee42e](https://github.com/wygoralves/panes/commit/38ee42e53830083252a117c73fde29452df9c048))
* fix review findings ([974acfb](https://github.com/wygoralves/panes/commit/974acfbc05dfe8b43f06adf7300c977c203f5b4e))
* harden keep-awake error-state handling ([eef98f4](https://github.com/wygoralves/panes/commit/eef98f4982fc94ef3c244886a5e106117adcf5f9))
* harden keep-awake state persistence ([42ce9bc](https://github.com/wygoralves/panes/commit/42ce9bc0bf6b1105c6770cf8c80eccc599d39c1c))
* harden keep-awake state transitions ([3df0c16](https://github.com/wygoralves/panes/commit/3df0c167a494da87c8a64d1cce2a36b3ccecb9a1))
* harden rust helper persistance and fix frontend state errors ([0323f93](https://github.com/wygoralves/panes/commit/0323f93baeb1186b195a6cfbc5e4c68ed9c8f66c))
* stop panes wake lock when app is no longer running ([641b4a6](https://github.com/wygoralves/panes/commit/641b4a68933e7bde80fd3e91cd05ebbd2af92e9c))

## [](https://github.com/wygoralves/panes/compare/v0.34.1...vnull) (2026-03-09)

### Bug Fixes

* reuse desktop artifacts in release bundles ([f302dc4](https://github.com/wygoralves/panes/commit/f302dc40c2c425b9531d609068f668c8f23e3f9c))

## [](https://github.com/wygoralves/panes/compare/v0.34.0...vnull) (2026-03-09)

### Bug Fixes

* fix macos build crash ([2a9107b](https://github.com/wygoralves/panes/commit/2a9107b0130c458b95a6efb69b71a8f3db122a70))

## [](https://github.com/wygoralves/panes/compare/v0.33.2...vnull) (2026-03-09)

### Features

* add universal macOS release support ([012f7b6](https://github.com/wygoralves/panes/commit/012f7b65e628e712280233ec1e4bafc2d80e1b1b))

## [](https://github.com/wygoralves/panes/compare/v0.33.1...vnull) (2026-03-09)

### Bug Fixes

* fix ci breaking issue and fix cancel i18n tags references ([bb642fb](https://github.com/wygoralves/panes/commit/bb642fb330f23c3f5a83d1454b6e7ee680821097))

## [](https://github.com/wygoralves/panes/compare/v0.33.0...vnull) (2026-03-09)

### Bug Fixes

* preserve terminal shortcuts and robust shell probes ([e7de0ed](https://github.com/wygoralves/panes/commit/e7de0ed4bb8d9b928220a5e60e397e6c73160493))

## [](https://github.com/wygoralves/panes/compare/v0.32.1...vnull) (2026-03-09)

### Features

* add Linux custom window chrome ([3d502d2](https://github.com/wygoralves/panes/commit/3d502d2a43cedaf113b1391518520816424a2adf))

### Bug Fixes

* fix regressions brought by custom window decoration ([8e1d942](https://github.com/wygoralves/panes/commit/8e1d942e30a3003ec815af4fe3b4d2d3931e1353))

## [](https://github.com/wygoralves/panes/compare/v0.32.0...vnull) (2026-03-09)

### Bug Fixes

* remove intrusive codex warning surfaces ([06b2923](https://github.com/wygoralves/panes/commit/06b292375474afa903066f5d8e2594dacfd55f7b))

## [](https://github.com/wygoralves/panes/compare/v0.31.1...vnull) (2026-03-09)

### Features

* improve window visuals for linux ([c5f30b9](https://github.com/wygoralves/panes/commit/c5f30b91ca0f3a370c1ab9c0379c689e89bacf1b))

## [](https://github.com/wygoralves/panes/compare/v0.31.0...vnull) (2026-03-09)

### Bug Fixes

* add fallback to prevent crashes on cosmis ([ad0781c](https://github.com/wygoralves/panes/commit/ad0781c3fa31af2c897de11da0fbfbfedd37133e))
* avoid transient appimage workspaces on linux ([3d09c50](https://github.com/wygoralves/panes/commit/3d09c50c07f4e76991a7d2d69ab6c9d08d16dcce))

## [](https://github.com/wygoralves/panes/compare/v0.30.0...vnull) (2026-03-08)

### Features

* add hunk navigation to git diff editor ([ae9138b](https://github.com/wygoralves/panes/commit/ae9138badc4eae364813ab7a9a6b831dbf86baaa))
* publish Homebrew cask for releases ([fbd9008](https://github.com/wygoralves/panes/commit/fbd9008e7b2613f4708ac794ae905157fff968e1))

### Bug Fixes

* fix chat titles not being correctly shown ([75299e7](https://github.com/wygoralves/panes/commit/75299e746ef326e240bcc239ef5f4bfa28e47dec))

## [](https://github.com/wygoralves/panes/compare/v0.29.0...vnull) (2026-03-08)

### Features

* align Claude sandbox and approval contracts ([8b1386d](https://github.com/wygoralves/panes/commit/8b1386d777d7580da42339b62bd35c482f4fec6c))

## [](https://github.com/wygoralves/panes/compare/v0.28.0...vnull) (2026-03-08)

### Features

* add desktop i18n with persisted locale ([bf3a992](https://github.com/wygoralves/panes/commit/bf3a992b0f4427d578a0bb0c7a738d40b8f52176))
* add diff editing in file editor ([aa79e23](https://github.com/wygoralves/panes/commit/aa79e2304cd29b902193e5f16c384ee219df4d2d))
* add focus mode ([20b614c](https://github.com/wygoralves/panes/commit/20b614cb93fc7173d23b04f052eaedc3627397e0))
* expand i18n coverage on git panel ([40362d3](https://github.com/wygoralves/panes/commit/40362d3fe1a3b46658a26682cd9caec425c0fc34))
* expand i18n coverage on the chat panel ([efb4301](https://github.com/wygoralves/panes/commit/efb4301bad7c3fafae5579c2143a65d448e8bb12))
* expand i18n coverage on the command palette ([9a55b4f](https://github.com/wygoralves/panes/commit/9a55b4fcb5b92cd572b1918f522e1565ce6375e5))
* expand i18n coverage on the file editor ([8fe028a](https://github.com/wygoralves/panes/commit/8fe028aeb45d30a50d39030fda456c6269957f99))
* expand i18n coverage on the harnesses page ([6a82785](https://github.com/wygoralves/panes/commit/6a8278555417826374cdcebe2ea99a32c23395c1))
* expand i18n coverage on the startup settings ([3875138](https://github.com/wygoralves/panes/commit/3875138154fea3f234dde6be2c8798d12ea0e540))
* expand i18n coverage on the terminal panel ([82439c4](https://github.com/wygoralves/panes/commit/82439c4a8bfea61f2a0e156089aafacfb1beacdd))
* expand i18n coverage on the workspace settings ([f578d69](https://github.com/wygoralves/panes/commit/f578d6973a6589aad56172329bcffee0cd2c8458))
* expand i18n coverage to the lp and docs ([b411c36](https://github.com/wygoralves/panes/commit/b411c3667dadefa8fb8bbf0566f62592e11d6b9f))
* improve ui for focus mode on chat view ([d450f36](https://github.com/wygoralves/panes/commit/d450f36f4f200f879c0da5b497d600521027f2c2))
* improve UI for search and command palette ([47d4bd0](https://github.com/wygoralves/panes/commit/47d4bd0efe6614e3d9417e202b8b25aaf7bffb76))
* move workspace search into command palette ([f708bd5](https://github.com/wygoralves/panes/commit/f708bd56cbccc9e264e1c6e0c8591957230901a6))
* update terminology for stage related actions in i18n ([e5e6f17](https://github.com/wygoralves/panes/commit/e5e6f178431925c245f5dd6195d60661e6116aba))

## [](https://github.com/wygoralves/panes/compare/v0.27.0...vnull) (2026-03-07)

### Features

* improve ui of git panel more options ([09bfe0b](https://github.com/wygoralves/panes/commit/09bfe0b30ade03adb4fe7a7083f442814ae81f92))
* improve usability for the workspace setup ([7f207f9](https://github.com/wygoralves/panes/commit/7f207f966d5f396eac6061daaf685f403148780b))

## [](https://github.com/wygoralves/panes/compare/v0.26.0...vnull) (2026-03-07)

### Features

* add metadata only resync path for title reconciliation ([8071ea7](https://github.com/wygoralves/panes/commit/8071ea7dd543fde78b2a1be250c53eaa03c064b1))
* add workspace settings for terminal and preferences ([7cf5c45](https://github.com/wygoralves/panes/commit/7cf5c45b545d699e0397d6908edc18c1e568eecd))
* cap git diff previews and reuse diff viewer ([7bd7436](https://github.com/wygoralves/panes/commit/7bd74361ffaec91963f6cd24635fa772fd69fef8))
* filter out hidden repos according to workspace settings ([9bd2e8c](https://github.com/wygoralves/panes/commit/9bd2e8cb3f72db786c0c400793196a00b0d71f3c))
* fix and cleanup workspace settings ([a1f0ea7](https://github.com/wygoralves/panes/commit/a1f0ea7fe6c02aaa8ebad86837d6be2a4c950350))
* improve ui for workspace settings ([23f1673](https://github.com/wygoralves/panes/commit/23f16734734c78b4c44884379f2f0b023e9dea51))
* overhaul workspace settings ui ([294895b](https://github.com/wygoralves/panes/commit/294895bdc31142ba0d49cb3d9134943dfb9b8841))

### Bug Fixes

* fix path for correct running of claude sidecar ([231e979](https://github.com/wygoralves/panes/commit/231e9792eaa4cb6a890135607a6b72fc6f6ec687))
* fix stale codex models effort when resuming threads ([39e9793](https://github.com/wygoralves/panes/commit/39e97938d03d4a00ea04db2348eeac1f01fc2819))
* fix UI styles for manage remotes dialog ([76e4bf7](https://github.com/wygoralves/panes/commit/76e4bf760ed356b99eeba071daa15088bcee749e))

## [](https://github.com/wygoralves/panes/compare/v0.25.0...vnull) (2026-03-06)

### Features

* harden Codex thread policy handling ([de95d09](https://github.com/wygoralves/panes/commit/de95d09f588387de0adddf845cce9c9cd631579a))
* improve UI for permissions ([ce2bde9](https://github.com/wygoralves/panes/commit/ce2bde93fb7251db8f249148dee4b71eee37efc7))
* some more ui updates for permission policies ([6c03489](https://github.com/wygoralves/panes/commit/6c03489d059d31f21d17ddc189c6d65c2b44f8c3))
* surface model reroutes and MCP progress ([4652270](https://github.com/wygoralves/panes/commit/4652270f9975a4d136eacdd3bb22cda28edc5ce1))

### Bug Fixes

* fix approval banners not resolving correctly ([32082d1](https://github.com/wygoralves/panes/commit/32082d1d0076bba63f7bb1cbd36f589e91ddeba3))
* harden permission flows for codex execution ([a8ea77c](https://github.com/wygoralves/panes/commit/a8ea77cae2fcec9d775b62a95d60460165bab40d))

## [](https://github.com/wygoralves/panes/compare/v0.24.0...vnull) (2026-03-06)

### Features

* add claude sdk integration to Panes ([8d39e58](https://github.com/wygoralves/panes/commit/8d39e582a0ee173404d18208b9df59dcbe3e8866))
* add tests for claude sdk ([a192fe3](https://github.com/wygoralves/panes/commit/a192fe3227d795c1379361f46f44c330cf99cfdf))
* harden claude integration ([a188d88](https://github.com/wygoralves/panes/commit/a188d883a11526d5425ac4b6d80596169eac1363))
* improve branding on chat components ([9f8e732](https://github.com/wygoralves/panes/commit/9f8e73208fa9f1eb3ff330491add4e9fdd465624))
* improve expandable components experience ([e857ab2](https://github.com/wygoralves/panes/commit/e857ab292145f3ea86766dd0978e7a192cbd0696))
* improve UI for chat components ([7d5c978](https://github.com/wygoralves/panes/commit/7d5c9785cf9a5bee3d6fb88096d26485c316dd8c))
* improve UI for permissions dropdown ([2ec7175](https://github.com/wygoralves/panes/commit/2ec71755b49861d4a77925f2b0904c6da95dd10f))
* improve UI of the model and engine picker ([38d0d1f](https://github.com/wygoralves/panes/commit/38d0d1fd6f9d6a5387595154ad6dbe4e44bd94ce))
* more performance and responsiveness improvements to the chat panel ([af86089](https://github.com/wygoralves/panes/commit/af8608990e5c501933a54ccd00a649bad73462eb))
* performance improvements on the chat panel ([1217a15](https://github.com/wygoralves/panes/commit/1217a153e8addd3c9bc56b47e8f622b255abd070))
* polish UI of the approval banners and harden claude sdk integration ([58ae068](https://github.com/wygoralves/panes/commit/58ae06838ab736f42f3e11f28c9fa67ad4d845a7))

## [](https://github.com/wygoralves/panes/compare/v0.23.0...vnull) (2026-03-04)

### Features

* add folder discard controls for git panel ([8ee5ec1](https://github.com/wygoralves/panes/commit/8ee5ec12d3f1e6f9a1a359e68571b6d7b37cb0f6))
* add performance improvements to chat and git panels ([aea4a3f](https://github.com/wygoralves/panes/commit/aea4a3f334795563a299e79d062d01a458e1ce0a))

## [](https://github.com/wygoralves/panes/compare/v0.22.0...vnull) (2026-03-03)

### Features

* add resize handle for diff component on the git panel ([d0e3593](https://github.com/wygoralves/panes/commit/d0e359348c0f8afb6dd514e98b22209b1ef271af))
* disable files and threads search by default ([9f4d9c1](https://github.com/wygoralves/panes/commit/9f4d9c17c8bb5ce3c9f4625ce254c7a80a93e4f8))

## [](https://github.com/wygoralves/panes/compare/v0.21.0...vnull) (2026-03-03)

### Features

* automatically checkout when creating new branch ([1e2c10c](https://github.com/wygoralves/panes/commit/1e2c10c380401cbb1a8bcdcdc233daedee13c00a))

### Bug Fixes

* fix lp logo not refreshing ([8375a19](https://github.com/wygoralves/panes/commit/8375a19d64c529acae982e1e6928784655ae68e9))

## [](https://github.com/wygoralves/panes/compare/v0.20.0...vnull) (2026-03-03)

### Features

* overall layout adjustments for git panel ([8ffdc0b](https://github.com/wygoralves/panes/commit/8ffdc0bf1c89874385be8c21ccd03c1bd50f8d18))

### Bug Fixes

* adjust padding of the gitpanel ([f853189](https://github.com/wygoralves/panes/commit/f8531896b748eaa1a4ad537ac2d01b2345c29658))
* remove unwanted divider on changes panel ([a697cca](https://github.com/wygoralves/panes/commit/a697ccaf955bb8e7b55811f3b32b87050f0c1ae8))

## [](https://github.com/wygoralves/panes/compare/v0.19.0...vnull) (2026-03-03)

### Features

* apply layout redesign ([35c0f15](https://github.com/wygoralves/panes/commit/35c0f1560bc09991a1aae61325832a3f4b41f77e))

### Bug Fixes

* adjust layout when rail sidebar is hidden ([d6de219](https://github.com/wygoralves/panes/commit/d6de219782b4b70138857127ebe1db50873c3436))

## [](https://github.com/wygoralves/panes/compare/v0.18.0...vnull) (2026-03-03)

### Features

* add file tree cache and progressive palette search ([8150139](https://github.com/wygoralves/panes/commit/8150139f428ea8f4a9966be890f27250d6eda790))
* add new command palette feature ([fad0b3e](https://github.com/wygoralves/panes/commit/fad0b3edf0455182359a74d95e1835c95e7792a3))
* add server-side branch search and load-more pagination ([35a178a](https://github.com/wygoralves/panes/commit/35a178aea19500b780f2ee39181ae84691ad7adb))

### Bug Fixes

* fix incorrect harness commands for kiro and droid ([bcafbe3](https://github.com/wygoralves/panes/commit/bcafbe368a59965a0aeb3959c021bc4ec820fed8))

## [](https://github.com/wygoralves/panes/compare/v0.17.0...vnull) (2026-03-02)

### Features

* add git worktrees management in git panel ([b136128](https://github.com/wygoralves/panes/commit/b136128f31e5a25f354bccbd332ca15a8f6b1e70))
* add git worktrees to multi-agent launching ([e3ecd99](https://github.com/wygoralves/panes/commit/e3ecd99099e2393cd3c7575924dfb0ddded8f6cd))
* add multiagent launching and broadcast mode ([f45d0fe](https://github.com/wygoralves/panes/commit/f45d0feefd051491506998ad25fd3b0f27c630d5))

### Bug Fixes

* fix plus button losing dom focus on terminal pane ([a6c5529](https://github.com/wygoralves/panes/commit/a6c552971a19d8a4037f16cdb7cdc90cac82dc5d))

## [](https://github.com/wygoralves/panes/compare/v0.16.0...vnull) (2026-02-26)

### Features

* improve focus logic on split panes on tui ([13c8c39](https://github.com/wygoralves/panes/commit/13c8c39e8f91827238c0cb0e5455b7db545d73cd))

## [](https://github.com/wygoralves/panes/compare/v0.15.0...vnull) (2026-02-25)

### Features

* add soft reset to git panel ([e729fda](https://github.com/wygoralves/panes/commit/e729fda780b5b8a998c3b1e4dbe9168a3b853bac))
* improve terminal persistance stability between workspaces ([30fd0c1](https://github.com/wygoralves/panes/commit/30fd0c18f3d60e11b113d5b9cf4f421e554e912a))
* preserve selected repo when moving across workspaces ([ef32c1f](https://github.com/wygoralves/panes/commit/ef32c1f1b16a3aa4d6374e85b1d10a15ec8f0291))

### Bug Fixes

* stabilize terminal bootstrap across workspace switches ([b0966bc](https://github.com/wygoralves/panes/commit/b0966bc28c63be4b81dbd7876d05e427a3182d05))

## [](https://github.com/wygoralves/panes/compare/v0.14.0...vnull) (2026-02-25)

### Features

* improve terminal tab naming logic for native harnesses ([cc5830f](https://github.com/wygoralves/panes/commit/cc5830f8cd9cdeab97f48832b385d5b896b9f551))
* improve UI of opening new projects ([a492ba2](https://github.com/wygoralves/panes/commit/a492ba2b99bed67e753d62c63c206a2086fe89d6))

### Bug Fixes

* fix race conditions for terminal and editor views not triggering on some cases ([1b2bcb7](https://github.com/wygoralves/panes/commit/1b2bcb74c968b6a22b6c56c962f1343b4e0a9788))
* fix terminal initialization sync on app opening ([7abcb5c](https://github.com/wygoralves/panes/commit/7abcb5cc3ad0b5d695a2ab671fdb083a62b42043))

## [](https://github.com/wygoralves/panes/compare/v0.13.1...vnull) (2026-02-24)

### Features

* improve overall UI of header and sidebar ([a3e0f5c](https://github.com/wygoralves/panes/commit/a3e0f5cf0a187876f15cb0b9e1e9df42efd6b504))

## [](https://github.com/wygoralves/panes/compare/v0.13.0...vnull) (2026-02-24)

### Bug Fixes

* fix alignment and update logo on rail sidebar ([3dda97c](https://github.com/wygoralves/panes/commit/3dda97ca12e2879a1aafc990a41f746188cab0e0))

## [](https://github.com/wygoralves/panes/compare/v0.12.2...vnull) (2026-02-24)

### Features

* improve message load on front and backend and improve stability of codex in sandboxed environments ([79673de](https://github.com/wygoralves/panes/commit/79673de49814eb67a018a3123e8747c8e358e872))

### Bug Fixes

* fix restrictions getting in the way of codex calling tools ([3a87dad](https://github.com/wygoralves/panes/commit/3a87dad7ae0cb9d09e12ceb288f3e3d815656464))

## [](https://github.com/wygoralves/panes/compare/v0.12.1...vnull) (2026-02-24)

### Bug Fixes

* cleanup unwanted diagnostics and ship fix to more complex tui not rendering correctly ([45af7b2](https://github.com/wygoralves/panes/commit/45af7b2a4f4b6918c0318953e9bc6dcd96902ece))
* fix stale data from git internals not showing in the git panel ([64af6ba](https://github.com/wygoralves/panes/commit/64af6bacd88e0d754ba1bb65632572b044d1e625))

## [](https://github.com/wygoralves/panes/compare/v0.12.0...vnull) (2026-02-24)

### Bug Fixes

* add more diagnostics for terminal frontend hanging ([2bfb19d](https://github.com/wygoralves/panes/commit/2bfb19dfc7f9a75a7ad7767fb53c57224f806b6c))

## [](https://github.com/wygoralves/panes/compare/v0.11.4...vnull) (2026-02-23)

### Features

* add harness identification for terminal tabs ([9b102c5](https://github.com/wygoralves/panes/commit/9b102c5acd7e45778020132378bdeb5d4d17304b))

### Bug Fixes

* add more diagnostics for handling more complex tui aplications ([937e89e](https://github.com/wygoralves/panes/commit/937e89e61d7d6c916af6009a3ea7556c3ec3c900))

## [](https://github.com/wygoralves/panes/compare/v0.11.3...vnull) (2026-02-23)

### Bug Fixes

* add more diagnostics and fallback logic for sandboxing ([fe37a00](https://github.com/wygoralves/panes/commit/fe37a0017e4895e89cdd92963258712d95632aad))

## [](https://github.com/wygoralves/panes/compare/v0.11.2...vnull) (2026-02-23)

### Bug Fixes

* add more diagnostics for fixing complex tui rendering and caps for memory consumption ([c26ceaf](https://github.com/wygoralves/panes/commit/c26ceaf727840e96a21704e5f9a63fa113a3204a))
* cleanup orphan terminal sessions when exiting app ([c0de122](https://github.com/wygoralves/panes/commit/c0de122a4369ee58a16541629289667997c001ab))

## [](https://github.com/wygoralves/panes/compare/v0.11.1...vnull) (2026-02-23)

### Bug Fixes

* add more diagnostics to complex tui rendering ([c9c7f20](https://github.com/wygoralves/panes/commit/c9c7f2011c5a6d2bc55cd3ad38111960085841c0))

## [](https://github.com/wygoralves/panes/compare/v0.11.0...vnull) (2026-02-23)

### Bug Fixes

* fix copy diagnostics constraint on prod build ([3fe76d9](https://github.com/wygoralves/panes/commit/3fe76d9e2f52bc59958d329770e74f5d585948d3))

## [](https://github.com/wygoralves/panes/compare/v0.10.0...vnull) (2026-02-23)

### Features

* add chat attachments, plan mode toggle, and context usage display ([e122ce7](https://github.com/wygoralves/panes/commit/e122ce7719fc35676153e0be2ce402a70c33cbc3))
* add drop to attach and allow txt and image attachments ([bbb82fe](https://github.com/wygoralves/panes/commit/bbb82fe8818b5a6401f90d0d0b35e6dd3cee2473))
* adjust semantics of the usage metrics ([7ea4d29](https://github.com/wygoralves/panes/commit/7ea4d29d93092ac56f277ba67254ca2bbef7dcdd))
* improve UI display of plan, attachments and limits ([0e73285](https://github.com/wygoralves/panes/commit/0e732859e6b345b32df6320c7282f0229545645f))
* properly wire plan, monitoring and attachments to codex app server ([71b41c9](https://github.com/wygoralves/panes/commit/71b41c978ddfe280648184fbb366b18ca3fdb3a4))

### Bug Fixes

* add diagnostics for debugging complex tui rendering ([fb4efb6](https://github.com/wygoralves/panes/commit/fb4efb64c9dd63997c7715b451f4fc3b4cc48162))
* fix possible sandbox broken fallbacks and codex setup health check ([a09ac19](https://github.com/wygoralves/panes/commit/a09ac197885ccabf9112f35930c3555aba6ab414))
* fix stash not properly showing in stash tab ([1ffa219](https://github.com/wygoralves/panes/commit/1ffa219195e8bc0d20986362e1a535dca1945f33))

## [](https://github.com/wygoralves/panes/compare/v0.9.0...vnull) (2026-02-23)

### Features

* add Codex as native harness with featured card styling ([e0193f7](https://github.com/wygoralves/panes/commit/e0193f77494998a979633858fa1b99691c422a9a))
* add Gemini CLI harness and landing page integrations section ([21f2ed8](https://github.com/wygoralves/panes/commit/21f2ed85fc45be3b7fe5b98a223a71f2680b58b3)), closes [#4285f4](https://github.com/wygoralves/panes/issues/4285f4)
* add harness installation panel for CLI tools ([e09bed7](https://github.com/wygoralves/panes/commit/e09bed73ef84bd811bdbe26fbac91d0d845837fb))
* polish and conclude agent harnesses experience ([a0b59ca](https://github.com/wygoralves/panes/commit/a0b59ca646b148dc06de589b4c68c13a0280c5cc))

### Bug Fixes

* fix factory droid and kiro places in lp and adjust harness logos ([3c65e68](https://github.com/wygoralves/panes/commit/3c65e681511caeb4f98553010711c08b63c8e0f9))
* several fixes to the harness scanning and initialization ([f191912](https://github.com/wygoralves/panes/commit/f19191239ab4bd9adc3923b10560cb1c5885e19c))

## [](https://github.com/wygoralves/panes/compare/v0.8.0...vnull) (2026-02-23)

### Features

* add view changed files in editor ([91735b6](https://github.com/wygoralves/panes/commit/91735b6819d5419b8584013a2e50f4cfc6fa82ec))
* widen support for more complex application in the tui ([5d28c20](https://github.com/wygoralves/panes/commit/5d28c204d001222fc871bb3c751d114b5f1a48d0))

## [](https://github.com/wygoralves/panes/compare/v0.7.0...vnull) (2026-02-22)

### Features

* add keyboard shortcuts for new terminal tabs and splits, and allow reordering of terminal tabs ([9de4ddc](https://github.com/wygoralves/panes/commit/9de4ddcd4b8c245f49cc0a2b772145fa1eb9f709))
* add native os menu actions support ([c538232](https://github.com/wygoralves/panes/commit/c5382325885d0fe01fece6a23af218480090acb3))
* add native text editor for quick edits ([efc806e](https://github.com/wygoralves/panes/commit/efc806e8172bd188aa14a5fdf4a9109396ea03a2))
* add new landing page for panes ([bd49d51](https://github.com/wygoralves/panes/commit/bd49d51ee2c0375e5f3d6a787b5acdf81787635e))
* add search + replace feature to text editor ([e3269dc](https://github.com/wygoralves/panes/commit/e3269dc392019ef05e16e088cf60d50af522108a))
* add stash and view commit diffs to git panel ([f5b4489](https://github.com/wygoralves/panes/commit/f5b44890a09b93c40b0d630f14844740f253ec56))
* improve action feedback with toast messages ([212cb6e](https://github.com/wygoralves/panes/commit/212cb6e705b11a377231c1f5806a1f2eb9f1e1a1))
* improve confirm ux with native component ([61de358](https://github.com/wygoralves/panes/commit/61de358e38ee5240e7a10d8d28cf93555c2482b0))
* improve landing page visuals and text ([0dc9911](https://github.com/wygoralves/panes/commit/0dc991154e50c3598651aaf918d9f69ace83e762))
* update landing page ([e6ff98c](https://github.com/wygoralves/panes/commit/e6ff98c5a06af6f6bc31775391cdd9acd7941dfd))

### Bug Fixes

* correctly extract actual exit code from terminal exit ([809c734](https://github.com/wygoralves/panes/commit/809c73498a1e80c0e2eccb30f2c326bc7c6199c4))
* fix compressed sidebar line overstepped by macos window controls ([2c5a613](https://github.com/wygoralves/panes/commit/2c5a6130ce55ba95c03c9ff08355774b4a36b159))
* fix drag and drop terminal tabs visual feedback ([4624bf9](https://github.com/wygoralves/panes/commit/4624bf9cbd04a9590c6f58f037d9f5e5ffb102b0))
* fix error handling on git operations ([14de42a](https://github.com/wygoralves/panes/commit/14de42aa468a1be812612746bdc9c9d6c04aa8d5))
* fix some lp card ordering ([9433985](https://github.com/wygoralves/panes/commit/943398589420c97f6b63e30f95322510443c9309))

## [](https://github.com/wygoralves/panes/compare/v0.6.0...vnull) (2026-02-22)

### Features

* add main view switcher for terminal only, split mode, or chat only ([a1be959](https://github.com/wygoralves/panes/commit/a1be95996f0c83f69da19eafe736ed21b8de71b0))
* add split feature to the terminal panes ([ef02dfd](https://github.com/wygoralves/panes/commit/ef02dfdf57500dddc8ea8016e44be28912a9463c))
* add terminal renaming ([3d9004a](https://github.com/wygoralves/panes/commit/3d9004a797ce70f968204a69afda215916f784c4))
* improve version updater experience ([e25204c](https://github.com/wygoralves/panes/commit/e25204cc8913be50aeb26c18566730e7ee460fc8))

### Bug Fixes

* fix css override disabling selection based editing shortcuts ([c96c9e0](https://github.com/wygoralves/panes/commit/c96c9e058993f61831de89b183df13354a3532b4))

## [](https://github.com/wygoralves/panes/compare/v0.5.1...vnull) (2026-02-21)

### Features

* add individual, folder and discard all changes to git panel ([827e699](https://github.com/wygoralves/panes/commit/827e699ad4aa52b26d38f191cc9f985ec486af5c))
* expand and improve the onboarding flow to setup the required deps ([22ad92a](https://github.com/wygoralves/panes/commit/22ad92a51a053e472ee4540ead5fd471ead69958))
* expand support on approvals mapper, add dedicated treatment to account refresh and avoid transport ambiguity ([961c19a](https://github.com/wygoralves/panes/commit/961c19a06a586c5239196f01e63c6b2d5b8958f7))
* improve ui for approval banner on codex chat ([844020a](https://github.com/wygoralves/panes/commit/844020a2e428799a75f10a3cead6faf3a93f3b47))
* persist sidebar expansion preference ([040544e](https://github.com/wygoralves/panes/commit/040544e37d6f9453e7e75761741b696e321779c0))
* small UI improvements to approval elements ([66f62c2](https://github.com/wygoralves/panes/commit/66f62c2ea3ec6250c1f8073a757522cb77788574))

### Bug Fixes

* correctly match execution policy options in chat ([7799452](https://github.com/wygoralves/panes/commit/7799452ef53af9b63510dab05ae07f29cedc19da))

## [](https://github.com/wygoralves/panes/compare/v0.5.0...vnull) (2026-02-21)

### Bug Fixes

* update some docs text ([a8c6178](https://github.com/wygoralves/panes/commit/a8c617898bedc0aa33afca4bd49265a947ab2468))

## [](https://github.com/wygoralves/panes/compare/v0.4.0...vnull) (2026-02-21)

### Features

* add autoupdater and update icons ([a5f9336](https://github.com/wygoralves/panes/commit/a5f9336e449cf79e764ad55690de014a8a94e556))

## [](https://github.com/wygoralves/panes/compare/v0.3.1...vnull) (2026-02-20)

### Features

* add search to branches, commits and stash tabs, and improve loading feedback ([dc2a49c](https://github.com/wygoralves/panes/commit/dc2a49c2614cf9314ebd1197d1bbf1fd2754b95a))
* persist history and drafts of commit messages and branch names ([0ceab37](https://github.com/wygoralves/panes/commit/0ceab37938b40683d0c6bf326df9d8bead6c7349))

### Bug Fixes

* fix minor misalignment on the git panel header border ([ca4c26a](https://github.com/wygoralves/panes/commit/ca4c26aec062219c8aaa783970d3023eb90d410f))

## [](https://github.com/wygoralves/panes/compare/v0.3.0...vnull) (2026-02-20)

### Bug Fixes

* fix health check lockages and improve initialization timeouts ([eb5b22b](https://github.com/wygoralves/panes/commit/eb5b22b3593e21ab7ba4e0e95dbfcc7ba087da8d))

## [](https://github.com/wygoralves/panes/compare/v0.2.0...vnull) (2026-02-20)

### Features

* improve wizard styling and add commands to active troubleshoot health checks ([0a8c678](https://github.com/wygoralves/panes/commit/0a8c67801676574824fbd80670b3be4375925a6b))

### Bug Fixes

* fix path detection for codex install on macos ([bee40b2](https://github.com/wygoralves/panes/commit/bee40b2500ddfc224e2572129c43671c692f7302))

##  (2026-02-20)

### Features

* add binary generation on release pipeline ([646f453](https://github.com/wygoralves/panes/commit/646f4535a1896ecacb6714b777fe8a283e6925cd))
* adjust chatstore concurrence ([faad07d](https://github.com/wygoralves/panes/commit/faad07de466f6d5a6be9eef28b49680f9d8620b3))
* adjust naming and icons for the app ([fbe1d78](https://github.com/wygoralves/panes/commit/fbe1d78c21dd8482a382250fd9d73f5cae7d531a))
* backend events coalescing, terminal lazy loading and performance telemetry ([7c8c7e6](https://github.com/wygoralves/panes/commit/7c8c7e6f7d7eaa58e1dfbbfb2ce6a3f69d97907b))
* expand git functionality ([0d4c43b](https://github.com/wygoralves/panes/commit/0d4c43b88c9c8eb1b1db4bb6531499b44600ee77))
* expand sandbox compatibility and fix other stuff ([824e194](https://github.com/wygoralves/panes/commit/824e19477ff507a14e4ec1ebab0663fbb279dc30))
* extract md parser to reutil core ([748fdbd](https://github.com/wygoralves/panes/commit/748fdbd068fc8d0fa327e2e62859f87939b4617b))
* implement pull push fetch and improve ui of the git panel ([de84846](https://github.com/wygoralves/panes/commit/de84846b8d48d3f706af244e5cd683ea68c616e2))
* implement terminal to the chat section ([38c8918](https://github.com/wygoralves/panes/commit/38c89180e9451b426069101485e32404af1f085d))
* implement timestamp and better format model labels ([02b667a](https://github.com/wygoralves/panes/commit/02b667a7abb78d6929073dc9a50b051fa4fca7b7))
* improve contrast con UI ([8c7795b](https://github.com/wygoralves/panes/commit/8c7795b034e166003ead61bb355585c4c08a17ed))
* improve diff usability of the changes tab in the git panel ([3f10231](https://github.com/wygoralves/panes/commit/3f102310c5c2dc2e75d3639a00112d29edaa1a92))
* improve empty state styling on the terminal ([bbc9a6a](https://github.com/wygoralves/panes/commit/bbc9a6a85833213f8331709aaad10167834cc21f))
* improve empty states and icons ([27d1347](https://github.com/wygoralves/panes/commit/27d1347a37f0e58d417ef726026088b1c55ea7da))
* improve model name persistance on models and allow staging multiple folders and files at the same time ([55a0e28](https://github.com/wygoralves/panes/commit/55a0e28bb20eac3987c56ac27e1389baff9c1176))
* improve resizing and dragging window capabilities ([fc2704f](https://github.com/wygoralves/panes/commit/fc2704fd36d9692ac1be909d45b921b0b2ceb322))
* improve sidebar design and chat persistance between sessions ([084baa4](https://github.com/wygoralves/panes/commit/084baa475c5eaf8a60a86033e9a9108ada92fc8b))
* improve thread identification logic ([9c75b1a](https://github.com/wygoralves/panes/commit/9c75b1a97b3d57e28eb16b3fc55c6e4cbfcf0c58))
* improve UI and feeling for the app ([b16df86](https://github.com/wygoralves/panes/commit/b16df8670c4fde8a55e1b473a631e4adb9db487e))
* improve ui and usability of the git panel ([579294d](https://github.com/wygoralves/panes/commit/579294dc9cd72e4d54fa9266f347500acd923d82))
* improve ui consistency of the messages area ([c8af74d](https://github.com/wygoralves/panes/commit/c8af74d376586ea49470de8719f67f6ba1f9f908))
* improve UI for the chat panel ([13b4345](https://github.com/wygoralves/panes/commit/13b4345cb3b27e39be6a2b29025df4c26f6e2904))
* improve UI of the sidebar ([6859738](https://github.com/wygoralves/panes/commit/6859738e7c7e92d45843f70738c862d2ee5bf1ad))
* make some more ui adjustments ([4d76a8e](https://github.com/wygoralves/panes/commit/4d76a8ec4974ac2406f07d313a77743d33cd623f))
* massive rendering performance improvements ([98afb4e](https://github.com/wygoralves/panes/commit/98afb4e8e689355c6f083a62d77bde03e78b2a13))
* massively improve the experience for multirepos ([ee3185e](https://github.com/wygoralves/panes/commit/ee3185ec83e17dc8530eb745d0abab7b1c23bbd1))
* massively improve UI and rendering of the integrated terminal ([9a73979](https://github.com/wygoralves/panes/commit/9a739794c992a4841263308f11ddc1a7f09e0144))
* more general high impact performance improvements ([90804f6](https://github.com/wygoralves/panes/commit/90804f63288b263491cbd874a0006a5a990033d7))
* more virtualization and performance improvements ([ca26aa8](https://github.com/wygoralves/panes/commit/ca26aa8d1b6cfc1134c8309aa2e387f31fa75d47))
* name threads and other adjustments ([0a8d160](https://github.com/wygoralves/panes/commit/0a8d160fdd9620ae4db15559d623a94bc1aa7ecd))
* onboarding/setup wizard for codex setup ([f5a968f](https://github.com/wygoralves/panes/commit/f5a968f4dd646690a33d0afe9ee40d08b1e1b572))
* optimize output action render and virtualization ([f37cc32](https://github.com/wygoralves/panes/commit/f37cc328ebc4937a6acce1264b7478aa810e4243))
* organize advanced settings ([22695b4](https://github.com/wygoralves/panes/commit/22695b49d57dfe64ff8dfbbb7ddef425825f60aa))
* persist terminal sessions when switching workspaces ([3856453](https://github.com/wygoralves/panes/commit/3856453f081b80ebe515d048ca27c047357bb454))
* persistance optimizations for performance improvements and other performance improvements ([b5f4e12](https://github.com/wygoralves/panes/commit/b5f4e1225b47103ac432ba9d77aa6fce76f9a20c))
* reorganize the diff panel of the changes tab ([e1f79a5](https://github.com/wygoralves/panes/commit/e1f79a5b9808758ac20128680916215684ad52a6))
* setup MVP of the panes app ([b215560](https://github.com/wygoralves/panes/commit/b2155603e0839a58332c059bd1eecb8191e246b4))
* several improvements to the core flow ([816e159](https://github.com/wygoralves/panes/commit/816e159d169191256f792afeed24b2d4f0651a1a))
* some more UI adjustments to text bubbles ([85dd321](https://github.com/wygoralves/panes/commit/85dd3211f8c3f1b45e750ea394afe35cf0fd0363))
* structure some basic ui to improve usability ([feac5ca](https://github.com/wygoralves/panes/commit/feac5caa744c87f4a36ad3866b0cf1efc595bb95))
* update codex app server compatibility and improvements across the board ([c68915b](https://github.com/wygoralves/panes/commit/c68915b1baab6ef81b5f6d46a31517bd6cb18f73))
* various improvements to initialization, ux and repos ([50c3b24](https://github.com/wygoralves/panes/commit/50c3b24a25337318b18c1aa6b087be7da87954ed))
* various improvements to overall reliability ([7e6365c](https://github.com/wygoralves/panes/commit/7e6365cb08ffc36bf7526911556823e25e790081))
* virtualize and add web worker to diff rendering ([fdcf9e2](https://github.com/wygoralves/panes/commit/fdcf9e254ff3308ca76fa669f688ad264de3f8cd))
* when no thread is selected, create a new thread ([26a6986](https://github.com/wygoralves/panes/commit/26a698656145f3df50258947599ce75ffa7cbc7d))
* wire git logic to the app ([7ee655b](https://github.com/wygoralves/panes/commit/7ee655b4485dacf2cdaea00548d031eddd5e331a))

### Bug Fixes

* adjust label for projects ([23df2c8](https://github.com/wygoralves/panes/commit/23df2c82ff88c0012aa6d7a646e920bea0f9695a))
* fix active thread selection ([88efc44](https://github.com/wygoralves/panes/commit/88efc440805e7bcbeff1fcb3ce4d80292384ae5f))
* fix commit button styling ([f8de002](https://github.com/wygoralves/panes/commit/f8de00248a473fcbf55d7e9191303233a84705bc))
* fix reasoning effort setup ([76cbb83](https://github.com/wygoralves/panes/commit/76cbb839f710029666492f8e0f1a0d476572103d))
* fix several minor findings ([4771961](https://github.com/wygoralves/panes/commit/4771961defe007e0b9cc193f48fe4cf2f165f401))
