document.addEventListener("DOMContentLoaded", () => {
  HFC.renderAllCarts();
  HFC.prefillBuyerForms();

  HFC.$("#checkoutForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await HFC.checkoutCart(event.currentTarget, HFC.$("#checkoutStatus"));
    } catch (error) {
      HFC.setStatus(HFC.$("#checkoutStatus"), error.message, true);
    }
  });

  HFC.$("#clearCartButton").addEventListener("click", async () => {
    HFC.clearCart();
    await HFC.renderAllCarts();
  });
});
