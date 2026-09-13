package in.zygertechnology.zygererp.repo;

import in.zygertechnology.zygererp.entity.*;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.*;

public interface OperatorMasterRepository extends JpaRepository<OperatorMaster, Long> {
    Optional<OperatorMaster> findByCode(String code);
    boolean existsByCode(String code);
    List<OperatorMaster> findByActiveTrue();
}
