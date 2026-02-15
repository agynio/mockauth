import bcrypt from "bcryptjs";

const ROUNDS = 12;

export const hashSecret = async (value: string): Promise<string> => {
  return bcrypt.hash(value, ROUNDS);
};

export const verifySecret = async (value: string, hash: string | null): Promise<boolean> => {
  if (!hash) {
    return false;
  }

  return bcrypt.compare(value, hash);
};
