package in.zygertechnology.zygererp.entity;

import java.math.BigDecimal;

public interface LineEntity {
    String getItemCode(); String getLocation(); String getBatchNo(); String getHeatNo();
    BigDecimal getQty();
    default BigDecimal getRate() { return null; }
    default String getItemDesc() { return null; }
    default String getDescription() { return null; }
    default String getUom() { return null; }
    default BigDecimal getAmount() { return null; }
    default BigDecimal getDiscount() { return null; }
    default BigDecimal getTax() { return null; }
    default BigDecimal getTaxAmount() { return null; }
    default BigDecimal getNetAmount() { return null; }
    default String getRejectedReason() { return null; }
    default BigDecimal getAcceptedQty() { return null; }
}

