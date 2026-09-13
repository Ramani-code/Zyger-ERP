package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import in.zygertechnology.zygererp.config.AuditEntityListener;
import java.time.Instant;
import java.time.LocalDate;

@Entity @Table(name = "operator_master")
@EntityListeners(AuditEntityListener.class)
@Getter @Setter @Builder @NoArgsConstructor @AllArgsConstructor
public class OperatorMaster {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) Long id;
    @Column(length = 60) String code;
    @Column(length = 200) String name;
    @Column(name = "skill_category", length = 60) String skillCategory;
    /** Comma-separated Machine Master `machineClass` values this operator is authorized on. */
    @Column(name = "machine_class_authorization", length = 500) String machineClassAuthorization;
    @Column(name = "certification_expiry") LocalDate certificationExpiry;
    @Column(length = 30) String shift;

    @Builder.Default Boolean active = Boolean.TRUE;
    String createdBy;
    Instant createdAt;
    String updatedBy;
    Instant updatedAt;
    @Version Long version;
    public boolean isActive() { return Boolean.TRUE.equals(active); }
}
