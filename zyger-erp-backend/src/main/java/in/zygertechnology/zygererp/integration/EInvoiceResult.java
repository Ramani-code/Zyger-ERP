package in.zygertechnology.zygererp.integration;

import java.time.Instant;

public record EInvoiceResult(String irnNumber, String irnAckNo, Instant irnAckDate, String qrPayload) {
}
