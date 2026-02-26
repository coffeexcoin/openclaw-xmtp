export const GET_REGISTRATION_FEE_ABI = [
  {
    type: "function",
    name: "getRegistrationFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const REGISTRATION_FEE_ABI = [
  {
    type: "function",
    name: "registrationFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const REGISTER_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "payable",
    inputs: [{ name: "tokenURI", type: "string" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
