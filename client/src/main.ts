import { BootstrapVue, IconsPlugin } from "bootstrap-vue";
import * as Colyseus from "colyseus.js";
import Vue from "vue";
import VueGtag from "vue-gtag";
import VueMeta from "vue-meta";
import Vuex from "vuex";
import * as Sentry from "@sentry/vue";
import { settings, isStagingOrProduction, SERVER_URL_WS } from "@port-of-mars/shared/settings";
import { Ajax } from "@port-of-mars/client/plugins/ajax";
import { TypedStore } from "@port-of-mars/client/plugins/tstore";
import { getAssetUrl, SfxManager } from "@port-of-mars/client/util";
import App from "./App.vue";
import router from "./router";
import store from "./store";

Vue.use(Vuex);
Vue.use(TypedStore);
Vue.use(Ajax, { router, store });
Vue.use(BootstrapVue);
Vue.use(VueMeta);
Vue.use(IconsPlugin); // FIXME: import only the icons we need
Vue.config.productionTip = false;

if (isStagingOrProduction()) {
  Sentry.init({
    dsn: import.meta.env.SHARED_SENTRY_DSN,
    integrations: [
      Sentry.browserTracingIntegration({ router }),
      Sentry.vueIntegration({ Vue, tracingOptions: { trackComponents: true } }),
    ],
    tracesSampleRate: 1,
  });
  Vue.use(
    VueGtag,
    {
      config: {
        id: import.meta.env.SHARED_GA_TAG,
      },
    },
    router
  );
}

const $client = new Colyseus.Client(SERVER_URL_WS || undefined);
const $sfx = new SfxManager();

Vue.prototype.$getAssetUrl = getAssetUrl;
Vue.prototype.$settings = settings;
declare module "vue/types/vue" {
  interface Vue {
    $settings: typeof settings;
    $getAssetUrl: typeof getAssetUrl;
  }
}

new Vue({
  router,
  store,
  render: h => h(App),
  provide() {
    return { $client, $sfx };
  },
}).$mount("#app");
