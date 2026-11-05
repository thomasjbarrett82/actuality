// The one tag the app owns in transaction notes (04 §5.1–5.2): needs-review. Every other tag is user data.
import { APP_NAME } from '../app';

export const REVIEW_TAG = 'needs-review';

/**
 * The color the protected `needs-review` tag entity gets when first created: Light `--review-row-border`
 * (05 §1.7). It syncs to every client, so it never follows the user's palette.
 */
export const REVIEW_TAG_COLOR = '#96A6D9';

/** The description stored on the `needs-review` tag entity (04 §5.2). Synced data, so it isn't translated. */
export const REVIEW_TAG_DESCRIPTION = `Used by ${APP_NAME} for transaction review`;
