export const CASES_PER_PALLET = 40
export const CASES_TO_EACHES = 24
export const EACHES_PER_PALLET = CASES_TO_EACHES * CASES_PER_PALLET

export const hashString = value => {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export const randomFromSeed = (seed, salt = '') => hashString(`${seed}|${salt}`) / 4294967295
export const randomIntFromSeed = (seed, salt, min, max) => min + Math.floor(randomFromSeed(seed, salt) * (max - min + 1))

export const getUomTypeFromSeed = seed => {
  const typeRoll = randomFromSeed(seed, 'uom-type')
  if (typeRoll < 0.4) return 'Each'
  if (typeRoll < 0.85) return 'Case'
  return 'Pallet'
}

export const getUomDisplayFromType = type => {
  if (type === 'Case') return 'CASES'
  if (type === 'Pallet') return 'PALLETS'
  return 'EACHES'
}

export const getQtyInBaseUomForType = (quantity, type) => {
  const numericQuantity = Number(quantity) || 0
  if (type === 'Case') return numericQuantity * CASES_TO_EACHES
  if (type === 'Pallet') return numericQuantity * EACHES_PER_PALLET
  return numericQuantity
}

export const getInventoryUomSimulation = item => {
  const seed = [
    item.skuCode,
    item.batch,
    item.binCode || item.location,
    item.id,
  ].filter(Boolean).join('|')
  const type = getUomTypeFromSeed(seed)

  if (type === 'Each') {
    const quantity = randomIntFromSeed(seed, 'each-qty', 10, 300)
    return { type, quantity, qtyInBaseUom: quantity }
  }

  if (type === 'Case') {
    const quantity = randomIntFromSeed(seed, 'case-qty', 2, 25)
    return { type, quantity, qtyInBaseUom: getQtyInBaseUomForType(quantity, type) }
  }

  const quantity = randomIntFromSeed(seed, 'pallet-qty', 1, 2)
  return { type, quantity, qtyInBaseUom: getQtyInBaseUomForType(quantity, type) }
}

export const getDriftUomDisplay = (item, quantity, side = 'current') => {
  const seed = [item.skuCode, item.id].filter(Boolean).join('|')
  const type = getUomTypeFromSeed(seed)
  return {
    type,
    quantity: Number(quantity) || 0,
    qtyInBaseUom: getQtyInBaseUomForType(quantity, type),
    label: getUomDisplayFromType(type),
    side,
  }
}
