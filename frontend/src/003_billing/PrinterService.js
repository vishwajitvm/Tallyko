export const PrinterService = {
  connect: async () => {
    console.log("[PrinterService] Scanning for Bluetooth printers...");
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log("[PrinterService] Connected to Thermal Printer (Mock)");
        resolve(true);
      }, 1000);
    });
  },
  printReceipt: async (order, cart, subtotal, gst, total) => {
    console.log("[PrinterService] Preparing to print receipt...");
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log("===============================");
        console.log("          TALLYKO POS          ");
        console.log("===============================");
        console.log(`Order #: ${order?.id?.substring(0, 8) || 'N/A'}`);
        console.log(`Type: ${order?.type || order?.order_type || 'N/A'}`);
        console.log("-------------------------------");
        if (cart) {
          cart.forEach(item => {
            const name = item.product?.name || item.name || 'Item';
            const price = item.product?.base_price || item.price || 0;
            console.log(`${item.quantity}x ${name}   $${(item.quantity * price).toFixed(2)}`);
          });
        } else {
          console.log(`Total Items Printed`);
        }
        console.log("-------------------------------");
        console.log(`Subtotal: $${Number(subtotal).toFixed(2)}`);
        console.log(`GST (5%): $${Number(gst).toFixed(2)}`);
        console.log(`Total:    $${Number(total).toFixed(2)}`);
        console.log("===============================");
        console.log("          THANK YOU!           ");
        console.log("===============================");
        console.log("[PrinterService] Print job completed.");
        resolve(true);
      }, 1500);
    });
  }
};
