# Changelog

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
