package in.zygertechnology.zygererp.repo;

import in.zygertechnology.zygererp.entity.PurchaseOrderSchedule;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface PurchaseOrderScheduleRepository extends JpaRepository<PurchaseOrderSchedule, Long> {
    List<PurchaseOrderSchedule> findByDocId(Long docId);
    List<PurchaseOrderSchedule> findByDocDocNoAndItemCode(String docNo, String itemCode);
}
