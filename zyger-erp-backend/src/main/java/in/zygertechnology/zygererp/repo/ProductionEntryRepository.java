package in.zygertechnology.zygererp.repo;

import in.zygertechnology.zygererp.entity.ProductionEntry;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;

public interface ProductionEntryRepository extends JpaRepository<ProductionEntry, Long> {
    List<ProductionEntry> findByWorkOrderNumber(String workOrderNumber);
    List<ProductionEntry> findByJobCardNumber(String jobCardNumber);
    List<ProductionEntry> findByRouteSheetNumber(String routeSheetNumber);
    List<ProductionEntry> findByStatus(String status);
    long countByStatus(String status);

    List<ProductionEntry> findByJobCardNumberAndOperationCode(String jobCardNumber, String operationCode);
    List<ProductionEntry> findByJobCardNumberAndOperationCodeAndStatus(String jobCardNumber, String operationCode, String status);

    @Query("SELECT pe FROM ProductionEntry pe WHERE pe.jobCardNumber = :jobCard AND pe.status IN ('POSTED', 'COMPLETED', 'APPROVED', 'SUBMITTED')")
    List<ProductionEntry> findCommittedEntriesForJobCard(@Param("jobCard") String jobCardNumber);

    /** Production Module FRS §5.3 BR (audit gap): entries still "running" on a machine —
     * started, not yet ended, and not cancelled/reversed — used to block starting a second,
     * overlapping entry on the same machine. */
    @Query("SELECT pe FROM ProductionEntry pe WHERE pe.machineCode = :machineCode AND pe.startTime IS NOT NULL "
            + "AND pe.endTime IS NULL AND pe.status NOT IN ('CANCELLED', 'REJECTED', 'REVERSED') AND pe.id <> :excludeId")
    List<ProductionEntry> findOpenByMachineCode(@Param("machineCode") String machineCode, @Param("excludeId") Long excludeId);
}
