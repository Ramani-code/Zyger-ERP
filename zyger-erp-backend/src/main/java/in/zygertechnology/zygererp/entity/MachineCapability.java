package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

/**
 * Production Module FRS v1.0 §4.1 — Machine/Work Center Master's "Capability Matrix: which
 * operations/part families the machine can run (used to filter machine choice on Job
 * Card)". No such data model existed at all before this — confirmed audit gap.
 *
 * <p>Deliberately additive/backward-compatible: a machine with zero capability rows is
 * treated as unrestricted (matches current behavior for every machine already in the
 * system, since none has ever had capability data). The filter only activates for a
 * specific machine once someone actually defines at least one capability row for it — see
 * ProductionJobCardService.addSubjob().</p>
 */
@Entity
@Table(name = "machine_capability")
@Getter @Setter @Builder @NoArgsConstructor @AllArgsConstructor
public class MachineCapability {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) Long id;

    @Column(name = "machine_code", length = 60, nullable = false) String machineCode;
    @Column(name = "operation_code", length = 60, nullable = false) String operationCode;
    /** Optional — a part family this machine/operation pairing is specifically qualified
     * for (e.g. tolerance/finish requirements), informational only for now. */
    @Column(name = "part_family", length = 60) String partFamily;
    @Column(length = 300) String remarks;

    @Builder.Default Boolean active = true;
    @Column(name = "created_by", length = 60) String createdBy;
    @Builder.Default Instant createdAt = Instant.now();
}
