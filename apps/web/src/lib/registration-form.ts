export type RegistrationField = {
  id: string;
  label: string;
  type:
    "text" | "textarea" | "email" | "phone" | "address" | "select" | "multi";
  scope: "team" | "member";
  required: boolean;
  options: string[];
};
export type RegistrationValues = Record<string, string | string[]>;
export type RegistrationAnswers = {
  team: RegistrationValues;
  members: Record<string, RegistrationValues>;
};
export const fieldTypes = {
  text: "单行文本",
  textarea: "多行文本",
  email: "邮箱",
  phone: "手机号",
  address: "寄件地址",
  select: "单选",
  multi: "多选",
};
