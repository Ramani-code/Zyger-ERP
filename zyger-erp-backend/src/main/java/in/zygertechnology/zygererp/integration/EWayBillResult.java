package in.zygertechnology.zygererp.integration;

import java.time.Instant;

public record EWayBillResult(String ewayBillNo, Instant validUpto) {
}
