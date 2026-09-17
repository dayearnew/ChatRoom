import { en, zhHans } from "vuetify/locale";
import { enChatRoom } from "./locales/en.js";
import { zhChatRoom } from "./locales/zhHans.js";

export type { AppLocale } from "./locales/types.js";
export {
  actionMessageKey,
  appIntlLocale,
  humanizeAction,
  initialAppLocale,
  sourceMessageKey,
  statusMessageKey,
} from "./locales/helpers.js";

export const chatroomLocaleMessages = {
  en: { ...en, chatroom: enChatRoom },
  zhHans: { ...zhHans, chatroom: zhChatRoom },
};
