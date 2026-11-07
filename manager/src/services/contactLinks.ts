export const whatsappUrl = (number: string, senderName: string) => {
  const digits = number.replace(/\D/g, '');
  const message = `Hi, I am ${senderName} from Reproutes. I need assistance.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
};

export const callUrl = (number: string) => `tel:${number.replace(/[^\d+]/g, '')}`;
