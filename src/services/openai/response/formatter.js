export function formatThreadForPrompt(threadMessages) {
  if (!threadMessages || !Array.isArray(threadMessages)) {
    return '';
  }

  return threadMessages
    .map(msg => {
      const role = msg.isIncoming ? 'Customer' : 'Appraisily';
      const date = new Date(msg.date).toLocaleString();
      return `[${date}] ${role}:\n${msg.content.trim()}\n`;
    })
    .join('\n---\n\n');
}

export function formatImageAttachments(imageAttachments) {
  return imageAttachments.map(img => ({
    type: "image_url",
    image_url: {
      url: `data:${img.mimeType};base64,${img.buffer.toString('base64')}`
    }
  }));
}