package in.zygertechnology.zygererp.repo;

import in.zygertechnology.zygererp.entity.MachineCapability;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface MachineCapabilityRepository extends JpaRepository<MachineCapability, Long> {
    boolean existsByMachineCodeAndActiveTrue(String machineCode);
    boolean existsByMachineCodeAndOperationCodeAndActiveTrue(String machineCode, String operationCode);
    List<MachineCapability> findByMachineCodeOrderByOperationCode(String machineCode);
    List<MachineCapability> findAllByOrderByMachineCodeAscOperationCodeAsc();
}
