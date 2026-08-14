// story-director 入口：加载模块、注册事件、挂载 UI
(function () {
    'use strict';

    const NAMESPACE = 'STORY_DIRECTOR';
    const VERSION = '0.1.0';

    if (window[NAMESPACE]?.loaded) {
        console.warn(`[story-director] Already loaded, skipping duplicate init.`);
        return;
    }

    window[NAMESPACE] = { loaded: true, version: VERSION };

    console.log(`[story-director] v${VERSION} loaded.`);
})();
