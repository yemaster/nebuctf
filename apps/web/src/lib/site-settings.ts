import { useAPI } from "./api";
export type SiteSettings = {
  name: string;
  footer_text: string;
  footer_link_label: string;
  footer_link_url: string;
  email_verification: boolean;
};
export const defaultSite: SiteSettings = {
  name: "NebuCTF",
  footer_text: "",
  footer_link_label: "",
  footer_link_url: "",
  email_verification: false,
};
export function useSiteSettings(enabled = true) {
  return useAPI<SiteSettings>("/site", enabled);
}
