import { createApp } from "vue";
import App from "./App.vue";
import { vuetify } from "./vuetify.js";
import "vuetify/styles";
import "@mdi/font/css/materialdesignicons.css";
import "./styles.css";

createApp(App).use(vuetify).mount("#app");
