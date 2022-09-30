const startCronJob = require("nugttah-backend/helpers/start.cron.job");
const Helpers = require("nugttah-backend/helpers");
const Invoice = require("nugttah-backend/modules/invoices");
const DirectOrder = require("nugttah-backend/modules/direct.orders");
const Part = require("nugttah-backend/modules/parts");
const DirectOrderPart = require("nugttah-backend/modules/direct.order.parts");

async function directOrderPartsGroupsFN(_id) {
  try {
    const dps = await DirectOrderPart.Model.find({
      createdAt: { $gt: new Date("2021-04-01") },
      fulfillmentCompletedAt: { $exists: true },
      invoiceId: { $exists: false },
    }).select("_id directOrderId partClass priceBeforeDiscount");
    const all_ps = await Part.Model.find({
      directOrderId: { $exists: true },
      createdAt: { $gt: new Date("2021-04-01") },
      partClass: "requestPart",
      pricedAt: { $exists: true },
      invoiceId: { $exists: false },
    }).select("_id directOrderId partClass premiumPriceBeforeDiscount");

    const allParts = all_ps.concat(dps);
    return Helpers.groupBy(allParts, "directOrderId");
  } catch (error) {
    throw error;
  }
}

async function getDirectOrder(_id) {
  try {
    return await DirectOrder.Model.findOne({ _id }).select("partsIds requestPartsIds discountAmount deliveryFees walletPaymentAmount");
  } catch (error) {
    throw error;
  }
}

async function getInvoces(directOrderId) {
  try {
    return await Invoice.Model.find({ directOrderId }).select("walletPaymentAmount discountAmount deliveryFees");
  } catch (error) {
    throw error;
  }
}

async function createInvoiceMecanism(
  directOrderId,
  directOrderPartsIds,
  requestPartsIds,
  totalPartsAmount,
  totalAmount,
  deliveryFees,
  walletPaymentAmount,
  discountAmount
) {
  try {
    const invoice = await Invoice.Model.create({
      directOrderId,
      directOrderPartsIds,
      requestPartsIds,
      totalPartsAmount,
      totalAmount,
      deliveryFees,
      walletPaymentAmount,
      discountAmount,
    });
    await DirectOrder.Model.updateOne({ _id: directOrderId }, { $addToSet: { invoicesIds: invoice._id } });
    for (const dp_id of directOrderPartsIds) {
      await DirectOrderPart.Model.updateOne({ _id: dp_id }, { invoiceId: invoice._id });
    }
    return invoice;
  } catch (error) {
    throw error;
  }
}
async function updateParts(rps_id, invoice) {
  try {
    // wait for updates before pushing to invoices array
    await rps_id.map((rp_id) => {
      return new Promise((resolve, reject) => {
        Part.Model.updateOne({ _id: rp_id }, { invoiceId: invoice._id })
          .then(function (result) {
            return resolve();
          })
          .catch(() => {
            reject();
          });
      });
    });
  } catch (error) {
    throw error;
  }
}

async function getTotalAmount(TotalPrice, invoces, walletPaymentAmount, discountAmount) {
  try {
    let totalAmount = TotalPrice;
    if (deliveryFees && invoces.length === 0) {
      totalAmount += deliveryFees;
    }
    if (walletPaymentAmount) {
      invoces.forEach((invo) => {
        walletPaymentAmount = Math.min(0, walletPaymentAmount - invo.walletPaymentAmount);
      });
      walletPaymentAmount = Math.min(walletPaymentAmount, totalAmount);
      totalAmount -= walletPaymentAmount;
    }
    if (discountAmount) {
      invoces.forEach((nvc) => {
        discountAmount = Math.min(0, discountAmount - nvc.discountAmount);
      });
      discountAmount = Math.min(discountAmount, totalAmount);
      totalAmount -= discountAmount;
    }

    if (totalAmount < 0) {
      throw Error(`Could not create invoice for directOrder: ${directOrder._id} with totalAmount: ${totalAmount}. `);
    }
    return totalAmount;
  } catch (error) {
    throw error;
  }
}

async function getInvoiceId(allDirectOrderParts) {
  try {
    let DOID = allDirectOrderParts[0].directOrderId;
    const [directOrder, invoces] = await Promise.all([await getDirectOrder(DOID), await getInvoces(DOID)]);

    const directOrderParts = allDirectOrderParts.filter(
      (directOrderPart) => directOrderPart.partClass === "StockPart" || directOrderPart.partClass === "QuotaPart"
    );
    const dps_id = directOrderParts.map((part) => part._id);
    const dpsprice = directOrderParts.reduce((sum, part) => sum + part.priceBeforeDiscount, 0);

    const requestParts = allDirectOrderParts.filter((part) => part.partClass === "requestPart");
    const rpsprice = requestParts.reduce((sum, part) => sum + part.premiumPriceBeforeDiscount, 0);
    const rps_id = requestParts.map((part) => part._id);

    const TotalPrice = Helpers.Numbers.toFixedNumber(rpsprice + dpsprice);

    let { deliveryFees, walletPaymentAmount, discountAmount } = directOrder;
    let totalAmount = getTotalAmount(TotalPrice, invoces, walletPaymentAmount, discountAmount);

    const [invoice] = await Promise.all([
      await createInvoiceMecanism(directOrder._id, dps_id, rps_id, TotalPrice, totalAmount, deliveryFees, walletPaymentAmount, discountAmount),
    ]);

    await Promise.all([await updateParts(rps_id, invoice)]);
    return invoice._id;
  } catch (error) {
    throw error;
  }
}

async function createInvoice() {
  try {
    const directOrderPartsGroups = await directOrderPartsGroupsFN();
    const invcs = directOrderPartsGroups.map(async (allDirectOrderParts) => await getInvoiceId(allDirectOrderParts));
    return { case: 1, message: "invoices created successfully.", invoicesIds: invcs };
  } catch (err) {
    Helpers.reportError(err);
  }
}

startCronJob("*/1 * * * *", createInvoice, true); // at 00:00 every day

module.exports = createInvoice;
