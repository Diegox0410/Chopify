export function orderStatusMessage(status, trackingCode = '') {
  const messages = {
    PAYMENT_APPROVED: '✅ Pago verificado con éxito.\n\nTu pedido ya está siendo preparado 💙\nTe avisaremos cuando esté listo.',
    PAYMENT_REJECTED: '⚠️ No pudimos validar el comprobante enviado.\n\nPor favor revisa los datos y envíalo nuevamente.\nSi necesitas ayuda, estoy aquí para ayudarte.',
    PREPARING: '💙 Tu pedido FLOES ya está en preparación. Te avisaremos cuando esté listo.',
    READY: '✨ Tu pedido ya está listo.\n\nEn breve coordinaremos el despacho o entrega contigo.',
    DISPATCHED: `🚚 ¡Tu pedido ya fue enviado!${trackingCode ? `\nGuía: ${trackingCode}` : ''}\n\nTe avisaremos cualquier novedad sobre la entrega.`,
    DELIVERED: '💙 Tu pedido aparece como entregado.\n\n¡Gracias por elegir FLOES!\nEsperamos que disfrutes mucho tu uniforme.',
  }
  return messages[status] || ''
}
