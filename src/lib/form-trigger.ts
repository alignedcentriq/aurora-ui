import { DynamicFormField } from "./chat-store";

export interface FormTriggerDetail {
  formId: number;
  name: string;
  description: string;
  fields: DynamicFormField[];
  submitEndpoint: string;
}

export function openFormById(detail: FormTriggerDetail) {
  window.dispatchEvent(new CustomEvent<FormTriggerDetail>("centriq:open-form", { detail }));
}

export function subscribeFormTrigger(handler: (detail: FormTriggerDetail) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<FormTriggerDetail>).detail);
  window.addEventListener("centriq:open-form", listener);
  return () => window.removeEventListener("centriq:open-form", listener);
}
