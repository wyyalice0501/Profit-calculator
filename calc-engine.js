/**
 * 萤石利润计算引擎 — 纯 JS，无 DOM 依赖
 * 可用于 Web / 微信小程序 / Node.js / 任何 JS 运行时
 *
 * 用法:
 *   import { calcProcess, calcTrade } from './calc-engine.js';
 *   const result = calcProcess(input);
 *   const result = calcTrade(input);
 */

// ===========================
//  Helpers
// ===========================
function toExcl(inclVal, vatRate) { return inclVal / (1 + vatRate); }
function toIncl(exclVal, vatRate) { return exclVal * (1 + vatRate); }

// ===========================
//  calcProcess(input) → result
// ===========================

/**
 * @typedef {Object} ProcessInput
 * @property {'incl'|'excl'} taxMode       - 税率模式
 * @property {number}       vatRate        - 增值税率 (0.13 = 13%)
 * @property {number}       rawQty         - 原矿采购数量（吨）
 * @property {number}       rawGrade       - 原矿品位 CaF₂（%）
 * @property {'ton'|'gradeprice'} procPriceMode - 原矿报价方式
 * @property {number}       rawPrice       - 元/吨（当 procPriceMode='ton'）
 * @property {number}       procGpRate     - 元/品位（当 procPriceMode='gradeprice'）
 * @property {number}       waterFee       - 用水费（元/吨原矿）
 * @property {number}       powerFee       - 用电费（元/吨原矿）
 * @property {number}       otherCost      - 其他费用（元）
 * @property {'ton'|'gradeprice'} tailPriceMode - 尾矿报价方式
 * @property {number}       tailPrice      - 尾矿售价 元/吨（当 tailPriceMode='ton'）
 * @property {number}       tailGpRate     - 尾矿 元/品位（当 tailPriceMode='gradeprice'）
 * @property {Array<{name:string, yield:number, grade:number, price:number}>} products
 */

/**
 * @typedef {Object} ProcessResult
 * @property {number} rawCostIncl / rawCostExcl
 * @property {number} processPerTonIncl / processPerTonExcl
 * @property {number} processTotalIncl / processTotalExcl
 * @property {number} totalCostIncl / totalCostExcl
 * @property {Array}  products         - 各产品 { name, yield, grade, price, priceIncl, priceExcl, qty, revenueIncl, revenueExcl }
 * @property {number} productQtyTotal
 * @property {number} productRevenueIncl / productRevenueExcl
 * @property {number} yieldSum / tailYield / tailQty / tailGrade
 * @property {number} tailPriceIncl / tailPriceExcl / tailRevenueIncl / tailRevenueExcl
 * @property {number} totalRevenueIncl / totalRevenueExcl
 * @property {number} profitIncl / profitExcl
 * @property {number} profitPerTonIncl / profitPerTonExcl
 * @property {number} profitMarginIncl / profitMarginExcl
 * @property {number} inputVat / outputVat / netVat
 * @property {number} caf2Input / caf2Output / recoveryRate
 * @property {string[]} warnings
 */

export function calcProcess(input) {
  const vat = input.vatRate ?? 0.13;
  const taxMode = input.taxMode || 'incl';
  const warnings = [];

  // ----- Step 1: Raw ore price -----
  let rawPrice;
  if (input.procPriceMode === 'gradeprice') {
    rawPrice = (input.procGpRate || 0) * (input.rawGrade || 0);
  } else {
    rawPrice = input.rawPrice || 0;
  }

  // ----- Step 2: Mass balance (doesn't depend on pricing) -----
  let productQtyTotal = 0, yieldSum = 0, weightedGrade = 0;
  const products = (input.products || []).map(p => {
    const qty = (input.rawQty || 0) * (p.yield || 0) / 100;
    productQtyTotal += qty;
    yieldSum += (p.yield || 0);
    weightedGrade += (p.yield || 0) * (p.grade || 0);
    return { ...p, qty };
  });

  const tailYield = Math.max(0, 100 - yieldSum);
  const tailQty = (input.rawQty || 0) * tailYield / 100;
  const tailGrade = tailYield > 0.001
    ? Math.max(0, ((input.rawGrade || 0) * 100 - weightedGrade) / tailYield)
    : 0;

  // ----- Step 3: Tailings price (depends on tailGrade) -----
  let tailPrice;
  if (input.tailPriceMode === 'gradeprice') {
    tailPrice = (input.tailGpRate || 0) * tailGrade;
  } else {
    tailPrice = input.tailPrice || 0;
  }

  // ----- Step 4: Tax conversion -----
  let rawPriceIncl, rawPriceExcl, waterFeeIncl, waterFeeExcl,
      powerFeeIncl, powerFeeExcl, tailPriceIncl, tailPriceExcl;

  if (taxMode === 'incl') {
    rawPriceIncl = rawPrice;     rawPriceExcl = toExcl(rawPrice, vat);
    waterFeeIncl = input.waterFee || 0; waterFeeExcl = toExcl(input.waterFee || 0, vat);
    powerFeeIncl = input.powerFee || 0; powerFeeExcl = toExcl(input.powerFee || 0, vat);
    tailPriceIncl = tailPrice;   tailPriceExcl = toExcl(tailPrice, vat);
  } else {
    rawPriceExcl = rawPrice;     rawPriceIncl = toIncl(rawPrice, vat);
    waterFeeExcl = input.waterFee || 0; waterFeeIncl = toIncl(input.waterFee || 0, vat);
    powerFeeExcl = input.powerFee || 0; powerFeeIncl = toIncl(input.powerFee || 0, vat);
    tailPriceExcl = tailPrice;   tailPriceIncl = toIncl(tailPrice, vat);
  }
  const otherCostIncl = input.otherCost || 0, otherCostExcl = input.otherCost || 0;

  // Convert product prices
  const productsWithTax = products.map(p => ({
    ...p,
    priceIncl: taxMode === 'incl' ? (p.price || 0) : toIncl(p.price || 0, vat),
    priceExcl: taxMode === 'incl' ? toExcl(p.price || 0, vat) : (p.price || 0),
  }));

  // ----- Step 5: Costs -----
  const rawCostIncl = (input.rawQty || 0) * rawPriceIncl;
  const rawCostExcl = (input.rawQty || 0) * rawPriceExcl;
  const processPerTonIncl = waterFeeIncl + powerFeeIncl;
  const processPerTonExcl = waterFeeExcl + powerFeeExcl;
  const processTotalIncl = (input.rawQty || 0) * processPerTonIncl + otherCostIncl;
  const processTotalExcl = (input.rawQty || 0) * processPerTonExcl + otherCostExcl;
  const totalCostIncl = rawCostIncl + processTotalIncl;
  const totalCostExcl = rawCostExcl + processTotalExcl;

  // ----- Step 6: Revenue -----
  let productRevenueIncl = 0, productRevenueExcl = 0;
  productsWithTax.forEach(p => {
    p.revenueIncl = p.qty * p.priceIncl;
    p.revenueExcl = p.qty * p.priceExcl;
    productRevenueIncl += p.revenueIncl;
    productRevenueExcl += p.revenueExcl;
  });

  const tailRevenueIncl = tailQty * tailPriceIncl;
  const tailRevenueExcl = tailQty * tailPriceExcl;
  const totalRevenueIncl = productRevenueIncl + tailRevenueIncl;
  const totalRevenueExcl = productRevenueExcl + tailRevenueExcl;

  // ----- Step 7: Profit -----
  const rawQty = input.rawQty || 0;
  const profitIncl = totalRevenueIncl - totalCostIncl;
  const profitExcl = totalRevenueExcl - totalCostExcl;
  const profitPerTonIncl = rawQty > 0 ? profitIncl / rawQty : 0;
  const profitPerTonExcl = rawQty > 0 ? profitExcl / rawQty : 0;
  const profitMarginIncl = totalRevenueIncl > 0 ? profitIncl / totalRevenueIncl * 100 : 0;
  const profitMarginExcl = totalRevenueExcl > 0 ? profitExcl / totalRevenueExcl * 100 : 0;

  // ----- Step 8: VAT -----
  const inputVat = (rawCostIncl - rawCostExcl) + (processTotalIncl - processTotalExcl);
  const outputVat = (productRevenueIncl - productRevenueExcl) + (tailRevenueIncl - tailRevenueExcl);
  const netVat = outputVat - inputVat;

  // ----- Step 9: CaF2 recovery -----
  const caf2Input = rawQty * (input.rawGrade || 0) / 100;
  const caf2Output = weightedGrade * rawQty / 10000;
  const recoveryRate = caf2Input > 0 ? caf2Output / caf2Input * 100 : 0;

  // ----- Warnings -----
  if (yieldSum > 100.01) warnings.push('产率合计已超过100%');
  if (recoveryRate > 100.01) warnings.push('CaF₂回收率超过100%，品位或产率可能不合理');
  if (tailGrade < 0) warnings.push('尾矿品位为负，产品中的CaF₂已超过原矿含量');

  return {
    // Costs
    rawCostIncl, rawCostExcl,
    processPerTonIncl, processPerTonExcl,
    processTotalIncl, processTotalExcl,
    totalCostIncl, totalCostExcl,

    // Products
    products: productsWithTax,
    productQtyTotal,
    productRevenueIncl, productRevenueExcl,

    // Tailings
    yieldSum, tailYield, tailQty, tailGrade,
    tailPriceIncl, tailPriceExcl,
    tailRevenueIncl, tailRevenueExcl,

    // Revenue & Profit
    totalRevenueIncl, totalRevenueExcl,
    profitIncl, profitExcl,
    profitPerTonIncl, profitPerTonExcl,
    profitMarginIncl, profitMarginExcl,

    // VAT
    inputVat, outputVat, netVat,

    // Technical
    caf2Input, caf2Output, recoveryRate,
    warnings,
  };
}

// ===========================
//  calcTrade(input) → result
// ===========================

/**
 * @typedef {Object} TradeInput
 * @property {'incl'|'excl'} taxMode
 * @property {number}       vatRate
 * @property {'ton'|'gradeprice'} priceMode   - 报价方式
 * @property {number}       purGpRate         - 元/品位（当 priceMode='gradeprice'）
 * @property {Array<{name:string, grade:number, qty:number, price:number}>} purGrades
 * @property {number}       transportRate     - 运输费（元/吨）
 * @property {number}       storageRate       - 仓储费（元/吨）
 * @property {number}       customsRate       - 报关费（元/吨）
 * @property {number}       portRate          - 港杂费（元/吨）
 * @property {number}       otherRate         - 其他费用（元/吨）
 * @property {number}       domQty / domPrice - 内销
 * @property {'usd'|'rmb'}  expCurr           - 外销币种
 * @property {number}       expQty
 * @property {number}       expPriceUsd       - FOB美元价
 * @property {number}       expPriceRmb       - FOB人民币价
 * @property {number}       expRate           - 汇率
 * @property {number}       rebateRate        - 出口退税率（%）
 */

/**
 * @typedef {Object} TradeResult
 * @property {number} purQty / purPrice / purGrade / purCostIncl / purCostExcl
 * @property {number} feesPerTon / feesTotal
 * @property {number} totalCostIncl / totalCostExcl
 * @property {number} domRevIncl / domRevExcl
 * @property {number} expFobRmb / exportRatio
 * @property {number} rebate
 * @property {number} totalRevIncl / totalRevExcl
 * @property {number} profitIncl / profitExcl
 * @property {number} profitPerTonIncl / profitPerTonExcl
 * @property {number} marginIncl / marginExcl
 * @property {number} inputVat / outputVat / netVat
 * @property {string[]} warnings
 */

export function calcTrade(input) {
  const vat = input.vatRate ?? 0.13;
  const taxMode = input.taxMode || 'incl';
  const warnings = [];
  const purGrades = input.purGrades || [];

  // ----- Step 1: Aggregate purchase -----
  let totalQty = 0, totalCost = 0, gradeWeightedSum = 0;
  purGrades.forEach(g => {
    const rowPrice = input.priceMode === 'gradeprice'
      ? (input.purGpRate || 0) * (g.grade || 0)
      : (g.price || 0);
    totalQty += (g.qty || 0);
    totalCost += (g.qty || 0) * rowPrice;
    gradeWeightedSum += (g.qty || 0) * (g.grade || 0);
  });

  const purQty = totalQty;
  const purPrice = purQty > 0 ? totalCost / purQty : 0;
  const purGrade = purQty > 0 ? gradeWeightedSum / purQty : 0;

  if (purQty <= 0) {
    return { purQty: 0, purPrice: 0, purGrade: 0, purCostIncl: 0, purCostExcl: 0,
             feesPerTon: 0, feesTotal: 0, totalCostIncl: 0, totalCostExcl: 0,
             domRevIncl: 0, domRevExcl: 0, expFobRmb: 0, exportRatio: 0, rebate: 0,
             totalRevIncl: 0, totalRevExcl: 0, profitIncl: 0, profitExcl: 0,
             profitPerTonIncl: 0, profitPerTonExcl: 0, marginIncl: 0, marginExcl: 0,
             inputVat: 0, outputVat: 0, netVat: 0, warnings: ['采购数量为0'] };
  }

  // ----- Step 2: Fees (all per-ton) -----
  const feesPerTon = (input.transportRate || 0) + (input.storageRate || 0)
    + (input.customsRate || 0) + (input.portRate || 0) + (input.otherRate || 0);
  const feesTotal = feesPerTon * purQty;

  // ----- Step 3: Tax conversion -----
  let purPriceIncl, purPriceExcl, domPriceIncl, domPriceExcl;
  if (taxMode === 'incl') {
    purPriceIncl = purPrice;   purPriceExcl = toExcl(purPrice, vat);
    domPriceIncl = input.domPrice || 0; domPriceExcl = toExcl(input.domPrice || 0, vat);
  } else {
    purPriceExcl = purPrice;   purPriceIncl = toIncl(purPrice, vat);
    domPriceExcl = input.domPrice || 0; domPriceIncl = toIncl(input.domPrice || 0, vat);
  }

  const purCostIncl = purQty * purPriceIncl;
  const purCostExcl = purQty * purPriceExcl;
  const totalCostIncl = purCostIncl + feesTotal;
  const totalCostExcl = purCostExcl + feesTotal;

  // ----- Step 4: Sales revenue -----
  const domQty = input.domQty || 0;
  const expQty = input.expQty || 0;
  const domRevIncl = domQty * domPriceIncl;
  const domRevExcl = domQty * domPriceExcl;

  let expFobRmb;
  if ((input.expCurr || 'usd') === 'rmb') {
    expFobRmb = expQty * (input.expPriceRmb || 0);
  } else {
    expFobRmb = expQty * (input.expPriceUsd || 0) * (input.expRate || 0);
  }

  // ----- Step 5: Quantity check -----
  const totalSalesQty = domQty + expQty;
  if (totalSalesQty > purQty + 0.001) {
    warnings.push('内销+外销数量超过采购数量');
  } else if (totalSalesQty < purQty - 0.001) {
    warnings.push(`尚有${(purQty - totalSalesQty).toFixed(1)}吨未售出`);
  }

  // ----- Step 6: Export rebate (进项税退还) -----
  const exportRatio = purQty > 0 ? expQty / purQty : 0;
  const rebateRate = (input.rebateRate || 0) / 100;
  const rebate = purCostExcl * exportRatio * rebateRate;

  // ----- Step 7: Total revenue & profit -----
  const totalRevIncl = domRevIncl + expFobRmb + rebate;
  const totalRevExcl = domRevExcl + expFobRmb + rebate;

  const profitIncl = totalRevIncl - totalCostIncl;
  const profitExcl = totalRevExcl - totalCostExcl;
  const profitPerTonIncl = purQty > 0 ? profitIncl / purQty : 0;
  const profitPerTonExcl = purQty > 0 ? profitExcl / purQty : 0;
  const marginIncl = totalRevIncl > 0 ? profitIncl / totalRevIncl * 100 : 0;
  const marginExcl = totalRevExcl > 0 ? profitExcl / totalRevExcl * 100 : 0;

  // ----- Step 8: VAT -----
  const inputVat = purCostIncl - purCostExcl;
  const outputVat = domRevIncl - domRevExcl; // export is zero-rated
  const netVat = outputVat - inputVat;

  return {
    purQty, purPrice, purGrade,
    purCostIncl, purCostExcl,
    feesPerTon, feesTotal,
    totalCostIncl, totalCostExcl,
    domRevIncl, domRevExcl,
    expFobRmb, exportRatio,
    rebate,
    totalRevIncl, totalRevExcl,
    profitIncl, profitExcl,
    profitPerTonIncl, profitPerTonExcl,
    marginIncl, marginExcl,
    inputVat, outputVat, netVat,
    warnings,
  };
}
