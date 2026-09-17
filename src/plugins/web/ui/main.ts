import { createApp } from "vue";
import App from "./App.vue";
import { vuetify } from "./vuetify.js";
import "vuetify/styles";
import "./styles/index.css";

createApp(App).use(vuetify).mount("#app");
