export class WhatsAppSendClosed extends Error {
  readonly code = 'WHATSAPP_SEND_NOT_AUTHORIZED' as const;

  constructor() {
    super('LIVE WHATSAPP SENDING IS NOT AUTHORIZED');
    this.name = 'WhatsAppSendClosed';
  }
}

export function sendWhatsAppCloudMessage(): never {
  throw new WhatsAppSendClosed();
}

export function submitWhatsAppTemplate(): never {
  throw new WhatsAppSendClosed();
}
