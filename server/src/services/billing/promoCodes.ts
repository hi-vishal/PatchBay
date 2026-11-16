import { createHash, randomInt } from 'node:crypto';
import type { Types } from 'mongoose';
import { PromoCode } from '../../models/PromoCode.js';
import { User } from '../../models/User.js';
import { AppError, conflict } from '../../utils/errors.js';

// Crockford base32: no I, L, O or U, so a code read aloud or retyped is hard to get wrong.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX = 'PB';
const GROUPS = 3;
const GROUP_LENGTH = 5;

/** 15 random characters, 75 bits: far too many to guess, even without the rate limit. */
export function generateCode(): string {
  const groups = Array.from({ length: GROUPS }, () =>
    Array.from({ length: GROUP_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''),
  );
  return [PREFIX, ...groups].join('-');
}

/** Accepts the code however it was typed: any case, with or without dashes and spaces. */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** The codes are random enough that a plain hash cannot be reversed by trying them all. */
export function hashCode(input: string): string {
  return createHash('sha256')
    .update(`promo:${normalizeCode(input)}`)
    .digest('hex');
}

export interface CreatePromoOptions {
  count?: number;
  label?: string;
  maxRedemptions?: number;
  expiresAt?: Date;
}

/** Returns the new codes. This is the only time they exist in plain text, so show them now. */
export async function createPromoCodes(options: CreatePromoOptions = {}): Promise<string[]> {
  const { count = 1, label = '', maxRedemptions = 1, expiresAt } = options;
  const codes = Array.from({ length: count }, generateCode);
  await PromoCode.insertMany(
    codes.map((code) => ({
      codeHash: hashCode(code),
      hint: code.slice(-4),
      label,
      maxRedemptions,
      expiresAt,
    })),
  );
  return codes;
}

const invalidCode = () =>
  new AppError(400, 'INVALID_PROMO_CODE', 'This code is not valid, has expired, or is used up.');

/**
 * Gives the user unlimited use. Taking a redemption is one atomic update, so a code with one use
 * left cannot be spent twice by parallel requests. Every failure gets the same message, so the
 * reply never tells a guesser which codes exist.
 */
export async function redeemPromoCode(userId: Types.ObjectId, input: string): Promise<void> {
  const user = await User.findById(userId);
  if (!user) throw invalidCode();
  if (user.promoCodeId) throw conflict('Your account already has unlimited use.');

  const now = new Date();
  const promo = await PromoCode.findOneAndUpdate(
    {
      codeHash: hashCode(input),
      revokedAt: { $exists: false },
      $and: [
        { $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] },
        { $expr: { $lt: [{ $size: '$redeemedBy' }, '$maxRedemptions'] } },
      ],
      redeemedBy: { $ne: userId },
    },
    { $push: { redeemedBy: userId } },
    { returnDocument: 'after' },
  );
  if (!promo) throw invalidCode();

  const granted = await User.updateOne(
    { _id: userId, promoCodeId: { $exists: false } },
    { $set: { promoCodeId: promo._id, unlimitedSince: now } },
  );
  if (granted.modifiedCount === 0) {
    // Another code won a race for this account. Give this one its use back.
    await PromoCode.updateOne({ _id: promo._id }, { $pull: { redeemedBy: userId } });
    throw conflict('Your account already has unlimited use.');
  }
}

export async function listPromoCodes() {
  return PromoCode.find().sort({ createdAt: -1 }).lean();
}

/** Stops the code working and takes unlimited use away from everyone who redeemed it. */
export async function revokePromoCode(id: string): Promise<{ found: boolean; users: number }> {
  const promo = await PromoCode.findOneAndUpdate(
    { _id: id },
    { $set: { revokedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!promo) return { found: false, users: 0 };
  const { modifiedCount } = await User.updateMany(
    { promoCodeId: promo._id },
    { $unset: { promoCodeId: 1, unlimitedSince: 1 } },
  );
  return { found: true, users: modifiedCount };
}
